# Security Policy

## 🛡️ 安全承诺与原则

Friday (Dora) 作为一个个人智能工作空间，处理用户的邮件、日程、文档及 Auth Token，安全与隐私是项目的重中之重：

1. **Token 隔离与安全存储**：Microsoft OAuth Refresh Token 仅存在服务端数据库中，严禁暴露给前端 DOM。
2. **破坏性操作 Human-in-the-Loop 门禁**：发送邮件、删除邮件等写操作必须经过 LangGraph Interrupt 门禁与 `hitl_action_audit` 表记录的用户显式二次确认，默认 24 小时未确认自动过期（`HITL_ACTION_TTL_SECONDS` 可调），避免 Agent 自增权或 LLM Prompt 注入越权。
3. **输入输出清洗**：所有邮件 HTML 内容在解析展示前均强制经过 `html_sanitizer` 过滤。

## 🐛 漏洞上报机制

如果您发现 Friday 项目中存在任何安全漏洞（如 Token 泄露、鉴权绕过、Prompt 注入越权等），请**切勿通过公开的 GitHub Issue 直接上报**。

请发送电子邮件至项目维护者邮箱或通过 GitHub 组织的私密漏洞报告功能（Security Advisories）联系：

- **邮件上报**：请私信项目负责人或发送报告至 `hunanjay` 的联系邮箱。
- **报告内容要求**：
  - 漏洞类型与大致风险级别
  - 复现步骤与 PoC (Proof of Concept)
  - 受影响的模块或 API 路径

我们将在 **48 小时** 内予以回应并确认漏洞修复时间表。致谢所有负责任的安全研究人员！
