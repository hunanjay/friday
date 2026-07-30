import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.infrastructure.db.repositories.token_store import get_github_repos, get_github_token

GITHUB_BASE = "https://api.github.com"

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient()
    return _client


async def aclose_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def github_get(user_id: str, path: str) -> dict | list:
    token = await run_in_threadpool(get_github_token, user_id)
    if not token:
        raise HTTPException(status_code=404, detail="No GitHub account linked")

    resp = await _get_client().get(
        f"{GITHUB_BASE}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="GitHub token invalid or revoked, reconnect GitHub")
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text}")
    return resp.json()


def _today_beijing_window() -> tuple[str, str]:
    beijing = timezone(timedelta(hours=8))
    start_of_day = datetime.now(beijing).replace(hour=0, minute=0, second=0, microsecond=0)
    since = start_of_day.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    until = datetime.now(beijing).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return since, until


async def list_commits(user_id: str, since: str | None = None, until: str | None = None) -> list[dict]:
    if since is None or until is None:
        default_since, default_until = _today_beijing_window()
        since = since or default_since
        until = until or default_until

    repos = await run_in_threadpool(get_github_repos, user_id)
    if not repos:
        repos = [os.environ.get("GITHUB_REPORT_REPO", "hunanjay/friday")]

    all_commits = []
    for repo in repos:
        try:
            data = await github_get(user_id, f"/repos/{repo}/commits?since={since}&until={until}&per_page=100")
        except HTTPException as e:
            if e.status_code == 404:
                continue
            raise
        for c in data:
            c["_repo"] = repo
        all_commits.extend(data)
    return all_commits


def format_commits(commits: list[dict]) -> str:
    if not commits:
        return "No commits in that range."
    return "\n\n".join(
        f"- repo={c.get('_repo', '?')} sha={c['sha'][:7]} author={c['commit']['author']['name']} "
        f"date={c['commit']['author']['date']}\n  {c['commit']['message']}"
        for c in commits
    )
