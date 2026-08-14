# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Friday" (branded in the UI as "Dora") — a self-hostable, bilingual (zh/en) personal AI workspace combining Email, Calendar, Chat, Memos (RAG), and Contacts, built on an explicit LangGraph multi-agent supervisor. Three parts:

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

# backend smoke tests (also in backend/tests/: contact + qdrant-fallback + live-LLM tests)
cd backend && .venv/bin/python tests/test_smoke.py

# frontend tests and production build
cd frontend && npm test && npm run build
```

GitHub Actions runs the backend smoke test and frontend lint, test, and build checks on every push and pull request.

## Backend architecture

**Agent system** (`app/agents/`): `supervisor.py` builds a `langgraph-supervisor` graph routing to four sub-agents — `mail_agent`, `calendar_agent`, `memos_agent`, `github_agent` (daily work report / 日报). Contacts have no dedicated agent; `mail_agent` exposes a `search_contacts` tool over the contacts DB, and the supervisor prompt forces any person/relationship question to that agent. `routing.py` is the sole routing policy: slash command first, explicit email-send/calendar-mutation second, supervisor otherwise. The graph is rebuilt per request with tools closed over the caller's `user_id`. Conversation state persists in Postgres via `langgraph-checkpoint-postgres` (`checkpointer.py`); the supervisor sees a trimmed 20k-token history, while `context.py` gives each domain agent a 10k-token task brief, current tool chain, and same-domain historical turns. `_ProxyCompatChatOpenAI` strips the `name` field from messages because the OpenAI proxy behind `OPENAI_BASE_URL` rejects it.

**Chat route** (`app/api/agent.py`): SSE streaming (`/api/agent/chat`). The shared routing policy can route slash commands and explicit sends directly to a sub-agent; that path reads/writes the supervisor checkpoint so context stays shared. `turn_lock.py` serializes same-session turns within the backend process to prevent concurrent checkpoint writes. New sessions get an auto-generated title (one cheap LLM call) streamed back as a `title` event.

**Destructive-action gate** (`app/agents/hitl.py`): built on LangChain's `HumanInTheLoopMiddleware`, not a hand-rolled table. `make_hitl_middleware` wires `interrupt_on` policies for `send_email`, `delete_email`, `create_event`, `delete_event`, `request_delete_event_on_day`, `accept_event`, `decline_event` — the middleware pauses the graph with a LangGraph `Interrupt` instead of letting the tool execute. `StateSnapshot.interrupts` is the sole source of pending actions (`GET /api/agent/actions`); the graph checkpoint is the only execution authority. A human decision resumes the graph via `Command(resume={interrupt.id: resume_value_for(...)})` (`POST /api/agent/actions/{action_id}/decisions/{decision_id}`, with `/confirm` and `/cancel` as approve/reject shortcuts) — this is what actually runs the Graph call, so there is no separate execution step to race. `hitl_audit.py` persists only the already-rendered card after resolution (`hitl_action_audit` table) so refreshing the UI doesn't lose completed/cancelled history; it is a display log, not the approval mechanism.

**Integrations** (`app/tools/`): `graph_client.py` (Microsoft Graph — Outlook mail/calendar, with token refresh-and-retry), `github_client.py` (commit activity for the daily report), `vector_store.py` (Qdrant + fastembed hybrid search over memos), `html_sanitizer.py`.

**Contacts** (`app/services/contact_service.py`, `contact_brain_service.py`, `app/api/contact.py`): CRUD plus an LLM-driven "brain" that extracts/enriches contact profiles (e.g. from pasted chat logs via `ChatLogPasteModal`), backed by `infrastructure/db/repositories/contacts.py`.

**Persistence** (`app/infrastructure/db/`): Supabase auth verification (`security.get_user_id` — the `Depends` on every route), Microsoft token storage (`token_store.py`), and agent data live in Postgres. `pool.py` owns one shared async psycopg pool used by the checkpointer, chat sessions, HITL audit, contacts, todos, and memos; schemas and clients are initialized in `main.py`'s lifespan.

## Frontend architecture

**Routing**: `src/router/index.jsx` — `/login` plus `MainLayout` wrapping `/dashboard` (default redirect), `/email`, `/calendar`, `/chat`, `/memos`, `/contacts`, `/settings`.

**State**: `WorkspaceContext.jsx` is the single source of truth. Emails/events still live in localStorage (shaped like the Microsoft Graph API schema); chat sessions, memos, contacts, and todos are backend-persisted and fetched once `authToken` is available. `ThemeContext.jsx` handles theming.

**Approval UI**: pending/completed HITL actions returned by the backend (`pending_actions` / `/api/agent/actions`) render through `common/ApprovalCard.jsx` and `common/ApprovalPreview.jsx`, keyed by the `presentation.renderer` and `placement` the backend already computed (see `common/approvalPlacement.js`) — the frontend does not decide what to show, only how to lay it out.

**Auth flow**: `LoginPage.jsx` → Supabase OAuth with the `azure` provider (Microsoft Entra). The Graph `provider_token`/`provider_refresh_token` only arrive on fresh sign-in, so the frontend immediately POSTs them to `/api/graph/token` for backend storage; thereafter the backend refreshes tokens itself (`/api/graph/refresh`, plus refresh-and-retry inside `graph_client`).

**i18n**: `react-i18next`, locales in `src/i18n/locales/{en,zh}.json`. All user-facing strings go through `t()` — add both languages when adding strings.

**CORS**: backend only allows `http://localhost:3005` — update `backend/app/main.py` if the frontend port changes.

## Environment

Both `frontend/.env` and `backend/.env` point at the same Supabase project. Copy from `.env.example` in each directory; keys are not committed. The backend additionally needs `OPENAI_MODEL` / `OPENAI_BASE_URL` (LLM), Qdrant, and GitHub OAuth settings — see `backend/.env.example`.

## Contributing

Conventional Commits (`<type>(<scope>): <subject>`, English, imperative, ≤72 chars) — see `CONTRIBUTING.md`. Branches are cut from `dev` as `<type>/<short-description>` and PR'd back into `dev`; `main` only receives tested merges from `dev`.
