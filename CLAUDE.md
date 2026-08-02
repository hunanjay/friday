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

# backend smoke tests
cd backend && .venv/bin/python tests/test_smoke.py

# frontend tests and production build
cd frontend && npm test && npm run build
```

GitHub Actions runs the backend smoke test and frontend lint, test, and build checks on every push and pull request.

## Backend architecture

**Agent system** (`app/agents/`): `supervisor.py` builds a `langgraph-supervisor` graph routing to four sub-agents — `mail_agent`, `calendar_agent`, `memos_agent`, `github_agent` (daily work report / 日报). `routing.py` is the sole routing policy: slash command first, explicit email-send second, supervisor otherwise. The graph is rebuilt per request with tools closed over the caller's `user_id`. Conversation state persists in Postgres via `langgraph-checkpoint-postgres` (`checkpointer.py`); the supervisor sees a trimmed 20k-token history, while `context.py` gives each domain agent a 10k-token task brief, current tool chain, and same-domain historical turns. `_ProxyCompatChatOpenAI` strips the `name` field from messages because the OpenAI proxy behind `OPENAI_BASE_URL` rejects it.

**Chat route** (`app/api/agent.py`): SSE streaming (`/api/agent/chat`). The shared routing policy can route slash commands and explicit sends directly to a sub-agent; that path reads/writes the supervisor checkpoint so context stays shared. `turn_lock.py` serializes same-session turns within the backend process to prevent concurrent checkpoint writes. New sessions get an auto-generated title (one cheap LLM call) streamed back as a `title` event.

**Destructive-action gate**: `send_email` / `delete_email` tools cannot mutate Microsoft Graph. They only write a 15-minute pending request to `pending_agent_actions`; the chat UI renders the trusted request data and calls an authenticated `/api/agent/actions/{id}/confirm` endpoint after an explicit click. The endpoint atomically changes `pending → executing` before the Graph call, preventing model self-approval and duplicate execution. Cancellation and expiry are persisted as terminal states.

**Integrations** (`app/tools/`): `graph_client.py` (Microsoft Graph — Outlook mail/calendar, with token refresh-and-retry), `github_client.py` (commit activity for the daily report), `vector_store.py` (Qdrant + fastembed hybrid search over memos), `html_sanitizer.py`.

**Persistence** (`app/infrastructure/db/`): Supabase auth verification (`security.get_user_id` — the `Depends` on every route), Microsoft token storage (`token_store.py`), and agent data live in Postgres. `pool.py` owns one shared async psycopg pool used by the checkpointer, chat sessions, pending actions, and memos; schemas and clients are initialized in `main.py`'s lifespan.

## Frontend architecture

**Routing**: `src/router/index.jsx` — `/login` plus `MainLayout` wrapping `/email`, `/calendar`, `/chat`, `/memos`, `/settings`.

**State**: `WorkspaceContext.jsx` is the single source of truth. Emails/events still live in localStorage (shaped like the Microsoft Graph API schema); chat sessions and memos are backend-persisted and fetched once `authToken` is available. `ThemeContext.jsx` handles theming.

**Auth flow**: `LoginPage.jsx` → Supabase OAuth with the `azure` provider (Microsoft Entra). The Graph `provider_token`/`provider_refresh_token` only arrive on fresh sign-in, so the frontend immediately POSTs them to `/api/graph/token` for backend storage; thereafter the backend refreshes tokens itself (`/api/graph/refresh`, plus refresh-and-retry inside `graph_client`).

**i18n**: `react-i18next`, locales in `src/i18n/locales/{en,zh}.json`. All user-facing strings go through `t()` — add both languages when adding strings.

**CORS**: backend only allows `http://localhost:3005` — update `backend/app/main.py` if the frontend port changes.

## Environment

Both `frontend/.env` and `backend/.env` point at the same Supabase project. Copy from `.env.example` in each directory; keys are not committed. The backend additionally needs `OPENAI_MODEL` / `OPENAI_BASE_URL` (LLM), Qdrant, and GitHub OAuth settings — see `backend/.env.example`.
