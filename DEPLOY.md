# Friday 部署指南

> 本文档覆盖**本地开发启动**和**生产部署**两个场景，适用于 Friday (Dora) 项目协作成员。

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                     用户浏览器                        │
└───────────────────┬─────────────────────────────────┘
                    │ HTTP / SSE
        ┌───────────▼──────────┐
        │   Frontend (React)   │  Port 3005  (Vite dev / Nginx / Vercel)
        └───────────┬──────────┘
                    │ REST API + SSE
        ┌───────────▼──────────┐
        │   Backend (FastAPI)  │  Port 8005
        └──┬──────────┬────────┘
           │          │
   ┌───────▼──┐  ┌────▼───────────────┐
   │PostgreSQL│  │ Qdrant Cloud / Local│
   │  :5438   │  └────────────────────┘
   └──────────┘
```

---

## 一、本地开发启动（推荐）

### 前置要求

| 工具 | 版本 |
|------|------|
| Python | 3.11+ |
| Node.js | 18+ |
| Docker + Docker Compose | 最新稳定版 |
| Git | 任意 |

### 1. Clone 仓库

```bash
git clone https://github.com/hunanjay/friday.git
cd friday
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

编辑 `backend/.env`，至少填写以下字段：

```env
OPENAI_API_KEY=          # 你自己的 Key
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
QDRANT_URL=...
QDRANT_API_KEY=...
```

> 完整字段说明见 `backend/.env.example` 注释，或查阅本文末尾的[环境变量速查表](#环境变量速查)。

### 3. 启动 PostgreSQL 数据库

`docker-compose.yml` 里除了 `db` 还定义了 `backend` 服务（容器化跑法，见下方"生产部署"）。本地开发用裸机 `uvicorn` 起后端，所以这里只起 `db`，避免两边都占 8005 端口冲突：

```bash
docker compose up -d db
```

验证数据库已就绪：

```bash
docker compose ps        # db 状态应为 healthy
```

### 4. 启动后端

```bash
cd backend

# 创建并激活虚拟环境
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 数据库迁移（首次启动前，以及之后每次 pull 到 schema 变更都要跑一次；
# 后端启动时不会自动建/改业务表）
alembic upgrade head

# 启动开发服务器（支持热重载）
uvicorn app.main:app --host 0.0.0.0 --port 8005 --reload --reload-dir app
```

后端 API 文档：http://localhost:8005/docs

### 5. 启动前端（新开终端）

```bash
cd frontend
npm install
npm run dev
```

访问：http://localhost:3005

---

## 二、Docker 全容器化生产部署

> 适合部署在 VPS / 云服务器上（如阿里云 ECS、腾讯云、Hetzner 等）。

### 1. 服务器环境准备

```bash
# 安装 Docker & Docker Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### 2. 拉取代码

```bash
git clone https://github.com/hunanjay/friday.git
cd friday
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入所有生产环境密钥
```

### 3. 构建前端静态文件

```bash
cd frontend
cp .env.example .env
# 编辑 frontend/.env，确认 Supabase URL 和 ANON_KEY
npm install
npm run build
# 产物输出到 frontend/dist/
```

### 4. 配置 Nginx 反向代理

在项目根目录创建 `nginx.conf`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 反向代理后端 API
    location /api/ {
        proxy_pass http://backend:8005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE 流式响应必须的配置
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }
}
```

在 `docker-compose.yml` 末尾追加 nginx 服务：

```yaml
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./frontend/dist:/usr/share/nginx/html:ro
    depends_on:
      - backend
```

### 5. 数据库迁移 + 启动全部服务

```bash
docker compose up -d --build db
docker compose run --rm backend alembic upgrade head
docker compose up -d --build
```

（`backend/docs/migrations.md` 有完整说明；这一步不会在后端启动时自动执行，漏跑会导致业务表缺失。）

### 6. HTTPS 配置（推荐）

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 申请证书（替换为你的域名和邮箱）
sudo certbot --nginx -d your-domain.com --email you@example.com --agree-tos
```

---

## 三、前端单独部署（Vercel）

> 适合前端部署到 Vercel、后端部署在云服务器的分离架构。

### Vercel 部署步骤

1. 在 [vercel.com](https://vercel.com) 导入 GitHub 仓库
2. 设置 **Root Directory** 为 `frontend`
3. **Framework Preset** 选择 `Vite`
4. 在项目 **Settings → Environment Variables** 中添加：

```
VITE_SUPABASE_URL=https://sbqgivaqomoyobfamwxt.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
```

5. 点击 **Deploy**

### 注意事项

- 确保后端 `main.py` 的 CORS `allow_origins` 包含了 Vercel 分配的域名
- 后端 `BACKEND_URL` / `FRONTEND_URL` 需更新为生产域名

---

## 环境变量速查

### `backend/.env`

| 变量 | 说明 | 是否必填 |
|------|------|----------|
| `LLM_PROVIDER` | `qwen` / `zhipu` / `custom`，切换整个 LLM profile | ✅（默认 `custom`） |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | `LLM_PROVIDER=qwen` 时用 | 按 provider 二选一 |
| `ZHIPU_API_KEY` / `ZHIPU_BASE_URL` / `ZHIPU_MODEL` | `LLM_PROVIDER=zhipu` 时用 | 按 provider 二选一 |
| `OPENAI_API_KEY` | `LLM_PROVIDER=custom` 时用，OpenAI / 中转 API Key | 按 provider 二选一 |
| `OPENAI_BASE_URL` | `LLM_PROVIDER=custom` 时的 API 地址 | 按 provider 二选一 |
| `OPENAI_MODEL` | `LLM_PROVIDER=custom` 时的模型名，默认 `gpt-4o-mini` | 可选 |
| `SUPABASE_URL` | Supabase 项目 URL | ✅ |
| `SUPABASE_ANON_KEY` | 公开 Key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端 Key（保密，勿提交） | ✅ |
| `SUPABASE_JWT_SECRET` | JWT 验证密钥 | ✅ |
| `ADMIN_USER_IDS` | 逗号分隔的 Supabase user id，允许读取 `GET /api/stats`；留空则该接口对所有人 403 | 可选 |
| `CHECKPOINT_DB_URL` | PostgreSQL 连接串（LangGraph checkpointer 用，`docker compose up` 会自动注入） | ✅ |
| `QDRANT_URL` | Qdrant 集群地址（memos 语义检索用） | ✅ |
| `QDRANT_API_KEY` | Qdrant API Key | ✅ |
| `AZURE_CLIENT_ID` | Azure AD OAuth App ID | 需要 MS 登录时 |
| `AZURE_CLIENT_SECRET` | Azure AD OAuth Secret | 需要 MS 登录时 |
| `MAIL_ENCRYPTION_KEY` | 加密第三方邮箱（IMAP/SMTP）授权码的 Fernet key，生成方式见 [`docs/mail-accounts.md`](./docs/mail-accounts.md) | 需要绑定第三方邮箱时 |
| `GITHUB_REPORT_REPO` | 报告目标仓库，如 `hunanjay/friday` | 可选 |
| `GITHUB_CLIENT_ID` | GitHub OAuth App ID | 需要 GitHub 连接时 |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Secret | 需要 GitHub 连接时 |
| `OSS_ACCESS_KEY_ID` | 阿里云 OSS Key | 需要文件上传时 |
| `OSS_ACCESS_KEY_SECRET` | 阿里云 OSS Secret | 需要文件上传时 |
| `OSS_ENDPOINT` | OSS 区域 Endpoint | 需要文件上传时 |
| `OSS_BUCKET` | 备忘录附件私有 Bucket | 需要文件上传时 |
| `OSS_AVATAR_BUCKET` | 头像预设公开 Bucket（Settings 头像选择器读这里的对象列表） | 可选 |
| `BACKEND_URL` | 后端公开地址 | 生产环境必填 |
| `FRONTEND_URL` | 前端公开地址 | 生产环境必填 |
| `TIMEZONE` | 时区，默认 `Asia/Shanghai` | 可选 |

> Langfuse tracing（`LANGFUSE_*`）是可选项，独立在 `docker-compose.tracing.yml` 里，`docker compose --profile tracing up -d` 才会启用，完整字段见 `backend/.env.example`。

### `frontend/.env`

| 变量 | 说明 |
|------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase 公开 Key |

---

## 常见问题排查

### 后端启动失败：`connection refused`（PostgreSQL）

```bash
docker compose ps        # 查看容器状态
docker compose logs db   # 查看数据库日志
```

### SSE 流式响应中断 / 无内容

检查 Nginx 配置是否包含：

```nginx
proxy_buffering off;
proxy_read_timeout 300s;
```

### 前端 CORS 报错

确认后端 `main.py` 的 `allow_origins` 列表包含前端域名。

### 前端空白页（生产构建）

```bash
# 确认环境变量以 VITE_ 开头
cat frontend/.env
# 重新构建
npm run build
```

---

## 端口一览

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 (dev) | 3005 | `npm run dev` |
| 后端 | 8005 | FastAPI + LangGraph |
| PostgreSQL | 5438 | Docker 映射（容器内 5432）|
| Nginx | 80 / 443 | 生产反向代理 |
