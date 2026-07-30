# Friday / Dora 智能助手 - 项目路线图与 TODO 计划

本文档记录了 Friday (Dora) 个人智能工作空间的未来功能规划与待办事项。

---

## 🎯 近期重点功能 (High Priority)

### 🧾 1. 发票与报销自动化 (Invoice & Expense Automation)
> **目标**：打造端到端的智能发票识别、自动查重、合规校验、行程关联与一键报销导出/发送功能。

#### 阶段 1：数据层与结构化提取 (Backend & Multimodal Parsing)
- [ ] **数据库表设计**：在 Postgres 中创建 `invoices` 表（保存 `invoice_code`, `invoice_number`, `amount`, `category`, `buyer_name`, `seller_name`, `invoice_date`, `file_path`, `status` 等），建立 `(user_id, invoice_code, invoice_number)` 联合唯一约束以防重复报销。
- [ ] **多模态发票解析 Tool**：新增 `extract_and_save_invoice` 工具，利用 Vision LLM / OCR 从拖拽上传的 PDF / 图片中提炼强格式化 JSON 数据。
- [ ] **合规校验逻辑**：校验发票买方抬头是否符合用户设定的公司名称、检查开票日期是否超期（如 90 天）。

#### 阶段 2：邮件自动化与行程联动 (Agent Integration)
- [ ] **邮件发票抓取**：扩展 `mail_agent`，使其能自动监听 Outlook 邮件，遇到电子发票/行程单附件时自动触发解析与入库。
- [ ] **日历行程关联**：与 `calendar_agent` 联动，自动将交通/打车/住宿发票匹配至当天的日历行程。

#### 阶段 3：报销导出与门禁发送 (Action Gate & Export)
- [ ] **报销单导出**：支持选择未报销发票，一键导出标准的 `.xlsx` 或 `.pdf` 汇总报销单。
- [ ] **一键拟定报销邮件**：配合 `send_email` 的 `pending_agent_actions` 确认门禁，自动生成附带发票打包压缩包和汇总明细的邮件草稿，待用户点击二次确认后发送给财务。

#### 阶段 4：前端交互与可视化卡片 (UI Widget)
- [ ] **Chat 发票高亮卡片**：在聊天框中渲染发票解析卡片（展示识别状态、金额、抬头校验结果、原始发票对比按钮）。
- [ ] **报销管理面板**：在前端添加发票分类统计与报销看板。

---

### 🎭 2. Dora 助手形象与人设自定义 (Agent Persona & Identity Customization)
> **目标**：允许用户自定义助手的名称（Dora/Friday/Jarvis等）、性格风格（干练/治愈/科技感/学术）、个性化 Custom Prompt 指令及专属头像。

#### 阶段 1：数据持久化与设置面板 (Settings & DB Schema)
- [ ] **数据库 Schema 扩充**：在 Postgres / Supabase 的 `user_profiles` 中增加 `agent_name`, `agent_avatar_url`, `persona_preset`, `custom_instructions` 字段。
- [ ] **前端 Settings 设置面板**：在 `/settings` 页面新增 "Agent Persona & Identity" 设置区域，支持切换性格预设（Preset）与编写 Custom Instructions。

#### 阶段 2：后端 Dynamic System Prompt 注入 (Dynamic Prompt Injection)
- [ ] **Supervisor Prompt 闭包构造**：在 `supervisor.py` 中，根据当前 caller 的 `user_id` 读取 `agent_name`、`persona_preset` 和 `custom_instructions`，动态注入 System Prompt 前置上下文。
- [ ] **子 Agent 语气同步**：保证 `mail_agent`, `calendar_agent`, `memos_agent` 均同步共享用户的性格与表达风格设定。

#### 阶段 3：前端 UI 形象与头像全量响应 (Dynamic Identity UI)
- [ ] **WorkspaceContext 全局响应**：全局状态绑定 `agentIdentity`。
- [ ] **Chat 消息与 Header 头像替换**：在 Chat 消息列表、Header 助手状态栏、通知弹窗中动态渲染用户自定义的 Agent 名称与头像图标。

---

## 🚀 中远期规划 (Future Roadmap)

### 📅 3. 主动式 Agent 任务与定时简报 (Proactive Briefings)
- [ ] **每日晨报 (Morning Briefing)**：每天定时扫描当天 Outlook 日程、紧急邮件与待办 Memos，生成焦点摘要。
- [ ] **每日夕报 (Evening Briefing)**：结合 `github_agent` 自动拉取当日 Commit / PR 记录，生成工作日报 Draft。

### 🔍 4. 全域知识库统一 RAG 检索 (Universal Cross-Module RAG)
- [ ] **多源向量索引**：将历史 Emails、Calendar 日程、GitHub Commits 统一注入 Qdrant，支持跨模块语义检索（如“查找上周关于数据库重构的邮件与会议”）。

### 👁️ 5. 可视化 Action 草稿与 Diff 模式 (Rich Action Draft & Diff)
- [ ] **变更对比预览**：在 Agent 修改 Memo、拟定长邮件或调整日程时，在聊天界面展示前后对比 Diff 卡片，支持用户划词编辑后批准执行。

### 🔬 6. 深度研究 Agent (Deep Research Worker)
- [ ] **长流程自主研究**：输入课题后由 Agent 自动在后台联网检索、总结抓取并生成结构化 Markdown 调研报告存入 Memos。
