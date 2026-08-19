from fastapi import APIRouter, Depends, HTTPException
from langchain_openai import ChatOpenAI
from starlette.concurrency import run_in_threadpool

from app.core.llm import make_chat_model
from app.core.security import get_user_id
from app.infrastructure.db.repositories.token_store import get_github_repos, set_github_repos
from app.tools.github_client import format_commits, github_get, list_commits

router = APIRouter(prefix="/api/github", tags=["github"])


@router.get("/repos")
async def repos(user_id: str = Depends(get_user_id)):
    """Repos available to pick from (the user's 100 most recently updated)
    plus which ones are currently selected for reports.
    # ponytail: no further pagination - a personal account with 100+ repos
    # to page through for this picker is an edge case."""
    available = await github_get(user_id, "/user/repos?per_page=100&sort=updated")
    selected = await run_in_threadpool(get_github_repos, user_id)
    return {
        "repos": [{"full_name": r["full_name"], "private": r["private"]} for r in available],
        "selected": selected,
    }


@router.put("/repos")
async def update_repos(body: dict, user_id: str = Depends(get_user_id)):
    repos = body.get("repos")
    if not isinstance(repos, list) or not all(isinstance(r, str) for r in repos):
        raise HTTPException(status_code=400, detail='repos must be a list of "owner/name" strings')
    await run_in_threadpool(set_github_repos, user_id, repos)
    return {"repos": repos}


@router.get("/commits")
async def commits(since: str | None = None, until: str | None = None, user_id: str = Depends(get_user_id)):
    """Commits across the user's selected repos in [since, until] (ISO 8601
    UTC, e.g. 2026-07-01T00:00:00Z). Both default to today's Beijing-day
    window."""
    data = await list_commits(user_id, since, until)
    return {
        "commits": [
            {
                "repo": c.get("_repo"),
                "sha": c["sha"],
                "author": c["commit"]["author"]["name"],
                "date": c["commit"]["author"]["date"],
                "message": c["commit"]["message"],
            }
            for c in data
        ]
    }


_summary_model: ChatOpenAI | None = None


def _get_summary_model() -> ChatOpenAI:
    global _summary_model
    if _summary_model is None:
        _summary_model = make_chat_model(temperature=0)
    return _summary_model


@router.post("/summary")
async def summary(body: dict, user_id: str = Depends(get_user_id)):
    """Synthesizes a work-report summary of commits across the user's
    selected repos in [since, until] (same defaulting as GET /commits).
    Doesn't save anything - POST the result to /api/memos yourself
    (category=work) if you want to keep it."""
    data = await list_commits(user_id, body.get("since"), body.get("until"))
    if not data:
        return {"summary": "No commits in that range.", "commit_count": 0}
    prompt = (
        "Summarize these git commits into a concise work report (grouped bullet "
        "points, grouped by repo if there's more than one). Base it only on the "
        "commit messages below, don't invent anything not reflected there.\n\n"
        + format_commits(data)
    )
    response = await _get_summary_model().ainvoke(prompt)
    return {"summary": response.content, "commit_count": len(data)}
