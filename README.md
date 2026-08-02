<div align="center">

# Friday (Dora)
### Self-Hostable Personal AI Workspace & Multi-Agent Copilot

  <p align="center">
    An open-source, bilingual (zh/en) personal workspace integrating <b>Outlook Mail</b>, <b>Calendar</b>, <b>Qdrant-powered RAG Memos</b>, and <b>GitHub Work Analytics</b> through an explicit multi-agent orchestration architecture. Currently in active alpha.
  </p>

  <p align="center">
    <a href="https://github.com/hunanjay/friday/actions/workflows/ci.yml"><img src="https://github.com/hunanjay/friday/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://github.com/hunanjay/friday/issues"><img src="https://img.shields.io/github/issues/hunanjay/friday" alt="Issues"></a>
    <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-0.139.0-009688.svg?logo=fastapi&logoColor=white" alt="FastAPI"></a>
    <a href="https://langchain-ai.github.io/langgraph/"><img src="https://img.shields.io/badge/LangGraph-1.2.7-FF6F00.svg?logo=langchain&logoColor=white" alt="LangGraph"></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19.0-61DAFB.svg?logo=react&logoColor=black" alt="React 19"></a>
    <a href="https://qdrant.tech/"><img src="https://img.shields.io/badge/Qdrant-Hybrid_Vector_DB-DC2626.svg?logo=qdrant&logoColor=white" alt="Qdrant"></a>
  </p>

</div>

---

## 📖 Overview

**Friday** (branded in UI as **Dora**) is an open-source, self-hostable personal productivity workspace in active alpha. Built on **FastAPI**, a **LangGraph multi-agent supervisor pattern**, and **React 19**, it connects Microsoft Graph and GitHub with personal knowledge management through Qdrant RAG. Its agent layer applies explicit routing and bounded, domain-specific context instead of sharing an unbounded cross-domain conversation history.

> **Project status: Alpha.** APIs, database schemas, and deployment details may change. Use a test Microsoft tenant/account when evaluating the project, and review its integration permissions before using sensitive data.

Design goals include **explicit control-flow scoping**, **deterministic agent routing**, **email write approval**, and **stateful multi-agent turn persistence**.

---

## 🏗️ System Architecture

The workspace separates client-side presentation, agent orchestration, and persistent storage integrations.

```mermaid
graph TD
    subgraph ClientLayer ["Client Layer (Presentation & Auth)"]
        FE["React 19 + Vite SPA (Port 3005)"]
        CTX["WorkspaceContext (State Engine)"]
        SupaAuth["Supabase Auth (Microsoft Entra Provider)"]
    end

    subgraph AgentRuntime ["Agent Orchestration Runtime (FastAPI + LangGraph)"]
        SSE["SSE Streaming Endpoint (/api/agent/chat)"]
        SupAgent["LangGraph Supervisor Router"]
        
        subgraph SubAgents ["Specialized Domain Sub-Agents"]
            MailA["Mail Agent (Outlook)"]
            CalA["Calendar Agent (Teams/Events)"]
            MemoA["Memos Agent (RAG)"]
            GHA["GitHub Agent (Analytics)"]
        end

        Gate["Email Action Gate (pending_agent_actions)"]
    end

    subgraph PersistenceLayer ["Persistence & External Services Layer"]
        Postgres[(PostgreSQL / langgraph-checkpoint)]
        QdrantDB[(Qdrant Vector DB / FastEmbed)]
        MSGraph["Microsoft Graph API (OAuth2)"]
        GHAPI["GitHub REST API"]
    end

    FE -->|Authenticate| SupaAuth
    FE -->|SSE Event Stream| SSE
    SSE --> SupAgent
    
    SupAgent -->|Deterministic / LLM Routing| SubAgents
    MailA <-->|Email Read/Draft| MSGraph
    CalA <-->|Event Read/Write| MSGraph
    GHA <-->|Activity Logs| GHAPI
    MemoA <-->|Hybrid Vector Search| QdrantDB
    
    SubAgents -->|Persist Turn Checkpoints| Postgres
    MailA -->|Enqueue Mutating Request| Gate
    FE -->|User Explicit Confirmation| Gate
    Gate -->|Execute Validated Request| MSGraph
```

---

## ⚙️ Core Technical Capabilities

### 1. Multi-Agent Supervisor & Deterministic Routing Pipeline
- **Orchestration**: Implements `langgraph-supervisor` to coordinate four isolated domain-specific sub-agents (`mail_agent`, `calendar_agent`, `memos_agent`, `github_agent`).
- **Routing Policy**: A single explicit policy applies slash-command routing first, deterministic email-send routing second, then falls back to the supervisor. This keeps the public entry paths consistent while preserving shared state checkpoints.
- **Context Management**: Conversation turns are persisted in PostgreSQL via `langgraph-checkpoint-postgres`. The supervisor receives a 20k-token trimmed history; each domain agent receives a 10k-token scoped task brief, its current tool-call chain, and only relevant same-domain prior turns.

### 2. Email Human-in-the-Loop (HITL) Action Gate
For supported email write operations:
- Mutating tools (`send_email`, `delete_email`) **never directly invoke external APIs**.
- When triggered, actions write an atomic payload to `pending_agent_actions` with a **15-minute TTL**.
- The frontend renders an isolated, trusted approval widget. Confirmation invokes `/api/agent/actions/{id}/confirm`, atomically transition states (`pending → executing → completed`) before executing downstream Graph API calls.

This is not yet a universal approval layer: other integration write paths must be reviewed separately before production use.

### 3. Hybrid RAG Knowledge Engine
- **Vector Infrastructure**: Powered by **Qdrant** combined with **FastEmbed** ONNX embeddings.
- **Hybrid Retrieval**: Merges dense semantic vector similarity with BM25 keyword matching for high-precision personal memo retrieval.

### 4. OAuth Identity & Token Lifecycle
- **Identity Provider**: Supabase Auth coupled with Microsoft Entra (Azure AD) OAuth2.
- **Silent Refresh Protocol**: Server-side token store (`token_store.py`) handles token refresh cycles out-of-band via `httpx` async connection pools, maintaining un-interrupted Graph API access without client-side credential exposure.

---

## 📂 Project Structure

```
friday/
├── backend/                        # FastAPI & LangGraph Backend Service
│   ├── app/
│   │   ├── agents/                 # Multi-agent graph & tool definitions
│   │   │   ├── supervisor.py       # LangGraph supervisor router
│   │   │   └── tools.py            # Agent tool schemas
│   │   ├── api/                    # REST & SSE API endpoints
│   │   │   ├── agent.py            # Chat streaming & action confirmation
│   │   │   └── auth.py             # Microsoft Graph token exchange
│   │   ├── infrastructure/         # External integrations & Persistence
│   │   │   ├── db/                 # Postgres connection pools & token stores
│   │   │   ├── graph/client.py     # Microsoft Graph Async HTTP client
│   │   │   └── vector_store.py     # Qdrant RAG client
│   │   └── main.py                 # Application lifecycle & middleware
│   ├── requirements.txt            # Python dependencies
│   └── Dockerfile
├── frontend/                       # React 19 Frontend SPA
│   ├── src/
│   │   ├── components/             # Reusable UI components & Action Widgets
│   │   ├── context/                # Global WorkspaceContext & ThemeContext
│   │   ├── i18n/                   # react-i18next locale files (zh/en)
│   │   ├── pages/                  # Page routes (Email, Calendar, Chat, Memos)
│   │   └── router/                 # React Router configuration
│   └── vite.config.js              # Vite build configuration
├── supabase/                       # Supabase configuration & migrations
├── TODO.md                         # Product Roadmap & Technical Backlog
└── README.md
```

---

## ⚡ Quick Start

### Prerequisites
- **Python**: `3.11` or higher
- **Node.js**: `v18.0` or higher
- **PostgreSQL**: `v14+` with binary psycopg pool support
- **Qdrant**: Local vector engine or Qdrant Cloud cluster

### 1. Environment Configuration

Copy environment template files in both `backend` and `frontend` directories:

```bash
# Backend Environment Setup
cp backend/.env.example backend/.env

# Frontend Environment Setup
cp frontend/.env.example frontend/.env
```

Key environment variables to populate in `backend/.env`:
- `OPENAI_API_KEY` & `OPENAI_BASE_URL`
- `AZURE_CLIENT_ID` & `AZURE_CLIENT_SECRET`
- `SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY`
- `CHECKPOINT_DB_URL`
- `QDRANT_URL` & `QDRANT_API_KEY`

### 2. Backend Installation & Execution

```bash
cd backend

# Create & activate virtual environment
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run development server (Port 8005)
uvicorn app.main:app --reload --port 8005
```

*For Agent Graph debugging, execute `langgraph dev` within `backend/` to open LangGraph Studio.*

### 3. Frontend Installation & Execution

```bash
cd frontend

# Install Node modules
npm install

# Start Vite dev server (Port 3005)
npm run dev
```

Navigate to `http://localhost:3005` in your browser.

---

### Quality Checks

```bash
# Backend smoke tests
cd backend
.venv/bin/python tests/test_smoke.py

# Frontend lint, tests, and production build
cd frontend
npm run lint
npm test
npm run build
```

GitHub Actions runs these checks for every push and pull request.

---

## 🛣️ Development Roadmap

Refer to [TODO.md](./TODO.md) or [GitHub Issue #1](https://github.com/hunanjay/friday/issues/1) for full feature specifications.

- [x] **Core Orchestration**: LangGraph Supervisor + Checkpoint Persistence
- [x] **Integrations**: Microsoft Graph API (Mail/Calendar) & GitHub REST API
- [x] **RAG Subsystem**: Qdrant + FastEmbed Hybrid Search
- [x] **HITL Gate**: 15-Minute TTL Pending Action Approval State Machine
- [ ] 🚧 **[In Development] Invoice & Expense Automation**: Multimodal invoice OCR, auto-duplication checks, and expense report generation.
- [ ] 📅 **Proactive Autonomous Briefings**: Scheduled daily morning/evening summaries.
- [ ] 🔍 **Universal RAG Indexing**: Cross-domain semantic search spanning Emails, Calendar, and Memos.

---

## 🔒 Security & Privacy Architecture

- **Token Safety**: Microsoft OAuth Refresh Tokens are stored exclusively server-side in PostgreSQL with encryption at rest and are never returned to the client DOM.
- **Input Sanitization**: Email HTML body content is sanitized via an internal `html_sanitizer` module to prevent prompt injection and XSS vectors.
- **State Machine Atomicity**: Pending destructive actions use database-level transactional locks to eliminate race conditions and dual-execution exploits.

---

## 📜 License

No license has been selected yet. Until one is added, do not assume permission to reuse, redistribute, or contribute code under particular terms.
