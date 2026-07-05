# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Friday" (branded in the UI as "Claude Suite") — a workspace app combining Email, Calendar, Chat, and Memos tabs, styled after Anthropic's design language. Three parts:

- `backend/` — FastAPI, currently a skeleton (`/health` only). `langchain` + `langchain-openai` are in requirements but not yet wired into any route.
- `frontend/` — React 19 + Vite, the actual working app.
- `supabase/` — Supabase project config (linked to `sbqgivaqomoyobfamwxt`), used only for auth in the frontend.

## Dev commands

```bash
# backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8005

# frontend
cd frontend && npm install && npm run dev   # served on port 3005 (see vite.config.js)

# frontend lint
cd frontend && npm run lint                 # oxlint
```

No test suite exists in either package yet.

## Architecture

**Auth**: Login (`frontend/src/components/Login.jsx`) uses Supabase OAuth with the `azure` provider (Microsoft Entra), requesting `Mail.Read` scope. `App.jsx` listens to `supabase.auth.onAuthStateChange`/`getSession` and captures `session.provider_token` into `graphToken` state — this is the Microsoft Graph API token, intended for real inbox sync (see `EmailTab`'s `onSyncInboxEmails`). Note the token only arrives on fresh sign-in, not after a page reload (see the `ponytail:` comment in `App.jsx`).

**State model**: `App.jsx` is the single source of truth for all app data (`emails`, `events`, `messages`, `memos`, `theme`, `isSidebarCollapsed`). Everything is plain `useState` seeded from `localStorage` on init and re-synced to `localStorage` via `useEffect` on every change — there is no backend persistence for this data yet, despite Supabase being configured. Data shapes deliberately mirror the Microsoft Graph API (Outlook Mail/Calendar) schema so a real Graph integration can drop in without reshaping state.

**Tab components** (`frontend/src/components/*Tab.jsx`) are presentational/controlled: they receive data + handler callbacks as props from `App.jsx` and call back up (`onAddEmail`, `onDeleteEvent`, etc.) rather than owning their own persistence.

**Icons**: `frontend/src/components/Icons.jsx` is a hand-rolled icon set (no icon library dependency).

**CORS**: backend only allows `http://localhost:3005` (the frontend's Vite dev port) — update `backend/app/main.py` if the frontend port changes.

## Environment

Both `frontend/.env` and `backend/.env` point at the same Supabase project. Copy from `.env.example` in each directory; keys are not committed.
