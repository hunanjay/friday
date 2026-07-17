# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Friday" (branded in the UI as "Dora") — a bilingual (zh/en) workspace app combining Email, Calendar, Chat, and Memos, styled after Anthropic's design language. Three parts:

- `backend/` — FastAPI + LangGraph multi-agent system (port 8005).
- `frontend/` — React 19 + Vite + react-router (port 3005).
- `supabase/` — Supabase project config (linked to `sbqgivaqomoyobfamwxt`), used for auth.

## Dev commands

```bash
# backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8005

# LangGraph Studio (debug the agent graph; pass user_id via the Studio "configurable" panel)
cd backend && langgraph dev

# frontend
cd frontend && npm install && npm run dev   # port 3005 (see vite.config.js)

# frontend lint
cd frontend && npm run lint                 # oxlint
```

No test suite exists in either package yet.

## Backend architecture

**Agent system** (`app/agents/`): `supervisor.py` builds a `langgraph-supervisor` graph routing to four sub-agents — `mail_agent`, `calendar_agent`, `memos_agent`, `github_agent` (daily work report / 日报). The graph is rebuilt per request with tools closed over the caller's `user_id`; conversation state persists in Postgres via `langgraph-checkpoint-postgres` (`checkpointer.py`), with `trim_messages` capping each LLM call's input at 20k tokens. `_ProxyCompatChatOpenAI` strips the `name` field from messages because the OpenAI proxy behind `OPENAI_BASE_URL` rejects it.

**Chat route** (`app/api/agent.py`): SSE streaming (`/api/agent/chat`). A message prefixed `/agent_name ...` (from ChatPage's slash-command picker) bypasses the supervisor LLM and routes deterministically to that sub-agent — supervisor LLM routing silently missed cases in practice — while reading/writing the supervisor's own checkpoint so context stays shared. New sessions get an auto-generated title (one cheap LLM call) streamed back as a `title` event.

**Destructive-action gate**: `send_email` / `delete_email` tools default to `confirm=False` (preview only); the model may only pass `confirm=True` after the user explicitly agrees in conversation. It's a soft, prompt-enforced gate — see the `ponytail:` comment in `agents/tools.py` for the upgrade path (LangGraph `interrupt()`).

**Integrations** (`app/tools/`): `graph_client.py` (Microsoft Graph — Outlook mail/calendar, with token refresh-and-retry), `github_client.py` (commit activity for the daily report), `vector_store.py` (Qdrant + fastembed hybrid search over memos), `html_sanitizer.py`.

**Persistence** (`app/db/`): Supabase auth verification (`supabase_client.get_user_id` — the `Depends` on every route), Microsoft token storage (`token_store.py`), chat sessions and memos in Postgres via psycopg pools. All pools/clients are initialized and torn down in `main.py`'s lifespan.

## Frontend architecture

**Routing**: `src/router/index.jsx` — `/login` plus `MainLayout` wrapping `/email`, `/calendar`, `/chat`, `/memos`, `/settings`.

**State**: `WorkspaceContext.jsx` is the single source of truth. Emails/events still live in localStorage (shaped like the Microsoft Graph API schema); chat sessions and memos are backend-persisted and fetched once `authToken` is available. `ThemeContext.jsx` handles theming.

**Auth flow**: `LoginPage.jsx` → Supabase OAuth with the `azure` provider (Microsoft Entra). The Graph `provider_token`/`provider_refresh_token` only arrive on fresh sign-in, so the frontend immediately POSTs them to `/api/graph/token` for backend storage; thereafter the backend refreshes tokens itself (`/api/graph/refresh`, plus refresh-and-retry inside `graph_client`).

**i18n**: `react-i18next`, locales in `src/i18n/locales/{en,zh}.json`. All user-facing strings go through `t()` — add both languages when adding strings.

**CORS**: backend only allows `http://localhost:3005` — update `backend/app/main.py` if the frontend port changes.

## Environment

Both `frontend/.env` and `backend/.env` point at the same Supabase project. Copy from `.env.example` in each directory; keys are not committed. The backend additionally needs `OPENAI_MODEL` / `OPENAI_BASE_URL` (LLM), Qdrant, and GitHub OAuth settings — see `backend/.env.example`.
