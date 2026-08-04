# Contributing to Friday

感谢参与 Friday 项目的开发！请在提交 PR 前阅读本文档。

---

## Commit 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>
```

### Type 类型

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(memos): add bulk delete support` |
| `fix` | Bug 修复 | `fix(auth): handle token expiry edge case` |
| `refactor` | 重构（不影响功能） | `refactor(agents): extract routing logic` |
| `docs` | 文档变更 | `docs: update DEPLOY.md nginx config` |
| `style` | 样式/格式（不影响逻辑） | `style(chat): adjust message bubble spacing` |
| `test` | 测试相关 | `test(smoke): add calendar agent test case` |
| `chore` | 构建、依赖、CI 等杂项 | `chore: bump fastapi to 0.140.0` |
| `perf` | 性能优化 | `perf(rag): cache fastembed model at startup` |

### Scope 作用域（可选）

`backend` / `frontend` / `agents` / `auth` / `mail` / `calendar` / `memos` / `github` / `rag` / `ci` / `docs`

### Subject 要求

- 用英文，动词开头，首字母小写
- 不超过 72 个字符
- 不以句号结尾

### 示例

```bash
# ✅ 正确
feat(mail): add email search by sender filter
fix(agents): prevent duplicate checkpoint writes under concurrent turns
docs: add CONTRIBUTING.md
chore(ci): cache pip dependencies in GitHub Actions

# ❌ 错误
fix bug          # 太模糊
Fix Bug.         # 首字母大写 + 句号
新增搜索功能      # 请用英文
```

---

## 分支规范

从 `main` 拉取功能分支，命名格式：

```
<type>/<short-description>
```

```bash
feat/invoice-ocr-parser
fix/sse-stream-disconnect
docs/deploy-guide
refactor/supervisor-routing
```

---

## PR 规范

### 提交前检查

```bash
# 后端
cd backend && .venv/bin/python tests/test_smoke.py

# 前端
cd frontend && npm run lint && npm test
```

### PR 标题

与 commit 格式保持一致：

```
feat(memos): add bulk delete support
fix(auth): handle Microsoft token expiry edge case
```

### PR 大小

- 单次 PR 尽量聚焦一个功能或修复
- 超过 500 行 diff 请拆分或在 PR 描述中说明原因

### 审查流程

1. 提交 PR → 自动触发 CI（后端 smoke test + 前端 lint/test/build）
2. CI 全部通过后，至少 **1 人 Review**
3. Review 通过后由 PR 作者 **Squash and Merge**

---

## 本地开发

参考 [DEPLOY.md](./DEPLOY.md) 完成环境搭建。
