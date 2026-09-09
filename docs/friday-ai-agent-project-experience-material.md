# Friday AI Agent 项目经历素材库

> 本文基于 Friday 当前后端、前端、评测代码和产品文档整理，用于撰写简历项目经历、作品集介绍和面试材料。本文是素材库，不建议整篇直接放入简历。涉及“主导、负责、提升比例、用户规模”等个人贡献或业务结果的内容，需要结合实际情况补充。
>
> 架构口径以当前代码为准：当前实现为 Parent Agent 将 5 个隔离的领域 Agent 封装为委派工具，而不是早期共享消息状态的 Handoff 架构。

## 一、项目基本信息

### 项目名称

Friday｜自托管 AI 关系大脑与个人执行工作台

### 一句话介绍

基于 LangGraph、LangChain、FastAPI 和 React 构建的自托管多 Agent 个人工作台，通过 Parent Agent 调度邮件、联系人、日历、备忘录和 GitHub 五个领域 Agent，将关系记忆、混合检索与 Human-in-the-Loop 业务执行整合到统一自然语言入口。

### 项目定位

Friday 是一个开源、可自托管、中英文双语的个人 AI 工作空间，面向销售、投资人、创业者、管理者和高频沟通的知识工作者。

产品希望解决的不是“再做一个聊天机器人”，而是把用户分散在邮件、通讯录、日历、聊天记录、备忘录和 GitHub 中的信息转化为可持续维护、可检索、可行动的个人关系记忆。

核心价值包括：

- 自动沉淀联系人身份、偏好、业务背景、需求和互动历史。
- 用自然语言检索人物、关系、邮件、日程和个人记录。
- 在沟通前找回与某个人相关的历史上下文和证据来源。
- 起草、回复和转发邮件，管理日程并生成工作日报。
- 对发送邮件、删除邮件和日历变更等高风险操作进行人工审批。
- 允许用户自托管数据和模型接入配置，保持对敏感关系数据的控制。

## 二、完整版项目简介

Friday 是基于 LangGraph、LangChain、FastAPI 和 React 构建的自托管多 Agent 个人 AI 工作台，围绕邮件、联系人关系记忆、日历、备忘录和 GitHub 工作记录提供统一的自然语言交互入口。

系统采用 Parent Agent 与领域子 Agent 分层架构。Parent Agent 负责理解用户意图、解析对话中的人物与时间指代，并将自包含任务委派给 Mail、Contact、Calendar、Memos 和 GitHub 五个隔离子 Agent；各子 Agent 只绑定所属领域工具及当前用户身份，从结构上限制工具范围、数据范围和上下文污染。

Friday 的核心能力是“关系大脑”。系统可以同步 Outlook 联系人，或从用户粘贴的聊天记录、会议记录和随手记中抽取联系人身份、标签、画像事实及互动时间线，并将每条事实与来源记录关联。查询时先使用 PostgreSQL 进行字面和结构化匹配，在没有直接结果时再使用 Qdrant 的 Dense Embedding 与 BM25 Sparse Vector 进行混合召回和 RRF 融合，使用户能够通过“最近在融资的医疗行业联系人”“喜欢喝普洱茶的投资人”等自然语言描述找回人物及关系上下文。

对于邮件发送、回复、转发、删除以及日历创建、删除、接受和拒绝等外部副作用，系统使用 LangChain HumanInTheLoopMiddleware 在工具执行前中断 LangGraph。前端展示结构化审批卡片，用户可以审核、编辑、批准或拒绝；批准后后端通过 LangGraph `Command(resume=...)` 恢复原有执行图，而不是创建第二套独立执行链路。PostgreSQL Checkpoint 是执行状态权威，持久化审计表只负责展示已解决记录，从而降低重复执行和审批竞态风险。

前端通过 SSE 实时展示模型输出、工具调用、最终权威回答、审批动作、会话标题和历史状态；后端使用 PostgreSQL 持久化 LangGraph Checkpoint、会话、联系人、备忘录、待办和用户记忆，并支持 Qdrant 混合检索、Microsoft Graph、GitHub OAuth、通用 IMAP/SMTP、Supabase Auth、Langfuse tracing 和 Docker 部署，形成较完整的 AI Agent 产品与工程化体系。

## 三、项目背景与业务问题

### 1. 传统通讯录缺少关系上下文

传统通讯录只能保存姓名、电话、公司等静态字段，无法记录：

- 对方最近在做什么。
- 上一次沟通谈到了什么。
- 对方的业务痛点与合作诉求。
- 兴趣偏好、家庭信息和重要日期。
- 用户应该在什么时候跟进。

### 2. 传统 CRM 录入成本高

CRM 依赖人工填写大量字段，个人用户往往难以长期维护，最终形成过期数据。Friday 尝试从邮件、通讯录、聊天记录和随手记中自动提取关系事实，降低关系信息沉淀成本。

### 3. 信息分散在多个系统

邮件、日历、联系人、备忘录和代码提交分别存在于 Outlook、GitHub、本地文件和数据库中。用户在准备会议、发送邮件或联系某人前，需要跨多个系统查找信息。

### 4. 普通 Agent 缺乏业务执行安全边界

大模型可以生成邮件和日程参数，但如果直接调用外部 API，可能出现：

- 收件人、正文或日期错误。
- 模型未获得用户确认就执行写操作。
- 重复点击或并发请求导致同一操作执行多次。
- 外部写入已经发生，但前端误判为失败后允许盲目重试。
- 模型在工具失败后仍声称执行成功。

Friday 将不可逆或高风险操作设计为可暂停、可审核、可编辑和可恢复的 LangGraph 工作流。

## 四、产品使用场景

### 1. 关系记忆

- “王总最近在忙什么？”
- “帮我记住李娜喜欢喝普洱茶。”
- “这是我和客户的聊天记录，帮我整理进联系人档案。”
- “最近有哪些在北京的医疗行业投资人？”

### 2. 邮件助手

- 查询未读邮件和指定主题邮件。
- 阅读并总结邮件正文。
- 根据联系人信息补全收件人。
- 根据已有 Memo 获取日报或材料并发送。
- 起草回复、转发邮件和标记已读。
- 在审批卡片中修改收件人、抄送、主题和正文后再发送。

### 3. 日历助手

- 查询某一天或某个时间范围的日程。
- 解析“明天下午”等自然语言日期。
- 创建和删除日程。
- 接受或拒绝会议邀请。
- 在多条日程匹配时请求用户明确选择。

### 4. 个人知识管理

- 创建、浏览和搜索 Memo。
- 上传 PDF、DOCX、文本或图片作为附件。
- 从图片中进行 OCR 或视觉模型解析。
- 维护长期项目和生活领域的持续记录。
- 结合 Dense、BM25 和 PostgreSQL 进行多级检索。

### 5. GitHub 日报

- 获取用户所选仓库当天的 GitHub Commit。
- 根据真实 Commit Message 生成结构化日报。
- 将日报保存到 Memo，供后续检索或邮件发送。

## 五、整体架构

```text
React 19 + Vite Web Frontend
        │
        │ REST / SSE / Approval Decisions
        ▼
FastAPI Backend
        │
        ▼
LangGraph Parent Agent
        │
        ├── delegate_to_mail_agent
        ├── delegate_to_contact_agent
        ├── delegate_to_calendar_agent
        ├── delegate_to_memos_agent
        └── delegate_to_github_agent
        │
        ▼
Isolated Domain Agents
        │
        ├── Microsoft Graph：邮件、日历、联系人
        ├── PostgreSQL：Checkpoint、业务数据、用户记忆
        ├── Qdrant：Dense + BM25 混合检索
        ├── GitHub API：Commit 与日报
        ├── IMAP / SMTP：通用邮箱
        ├── Supabase：身份认证
        └── Langfuse：Agent tracing
```

### 当前 Agent 组成

系统包含一个 Parent Agent 和五个专业领域 Agent：

1. Mail Agent
2. Contact Agent
3. Calendar Agent
4. Memos Agent
5. GitHub Agent

每个领域 Agent 还会获得用户长期记忆工具，用于记住、查询和删除用户自身的稳定事实及偏好。

## 六、多 Agent 架构设计

### 1. Parent Agent

Parent Agent 负责：

- 理解用户当前请求。
- 判断是否需要调用领域 Agent。
- 处理问候、闲聊以及无需外部工具的问题。
- 解析代词、人物和相对日期。
- 将请求改写成自包含任务后交给领域 Agent。
- 接收领域 Agent 返回结果并形成最终回答。

Parent Agent 不直接拥有邮件、联系人或日历业务工具，只拥有五个 `delegate_to_*` 委派工具。这使顶层模型负责协调，而具体业务能力由领域 Agent 执行。

### 2. Agents-as-Tools 与上下文隔离

当前实现没有让所有 Agent 共享完整消息历史，而是将每个领域 Agent 封装成一个委派工具：

1. Parent Agent 根据工具描述选择目标领域。
2. Parent Agent 生成已经解析人物、代词和日期的自包含任务。
3. 领域 Agent 只接收这条任务，而不是整个会话历史。
4. 领域 Agent 在限定工具集中完成任务。
5. 结果作为工具返回值交回 Parent Agent。

这一结构带来的收益：

- 减少多个 Agent 共享消息产生的上下文污染。
- 避免子 Agent 看到其他领域的 Tool Call 与 Tool Message。
- 限制单次子 Agent 的上下文长度和 Token 成本。
- 让每个领域的 Prompt、工具和职责边界更加清晰。
- 便于对路由、工具选择和最终回答分别评测。

### 3. 路由策略

当前路由优先级为：

1. 用户显式输入 `/mail_agent`、`/contact_agent` 等 Slash Command 时，直接进入对应委派工具。
2. 其他请求统一交给 Parent Agent，由委派工具描述作为路由策略事实源。

Slash Command 路径仍写入同一个 LangGraph Checkpoint，因此不会形成与普通对话割裂的会话历史。

### 4. 历史裁剪

Parent Agent 对模型输入设置约 20k Token 上限：

- 只裁剪本轮模型输入。
- PostgreSQL Checkpoint 仍保留完整会话历史。
- 使用 Human/Tool 边界裁剪，减少破坏 AI Tool Call 与 Tool Message 配对的风险。

### 5. 用户长期记忆

每个领域 Agent 都可以调用：

- `remember_user_fact`
- `search_user_memory`
- `forget_user_fact`

记忆分为：

- `profile`：用户身份、职业、长期目标等稳定事实。
- `preference`：用户希望助手遵守的回复风格。
- `topic`：与邮件、日历等特定领域相关的习惯。

Profile 和 Preference 会在每次构建 Agent 时注入系统 Prompt，使个性化信息可以跨会话生效；同一 `fact_key` 更新时覆盖旧值，降低相互矛盾的重复记忆。

## 七、五个领域 Agent

### 1. Mail Agent

负责：

- 列出收件箱及其他邮件文件夹。
- 根据主题、正文、发送人、未读状态和附件条件搜索邮件。
- 读取并清洗 HTML 邮件正文。
- 发送、回复和转发邮件。
- 标记邮件已读或未读。
- 将邮件移动到 Deleted Items。
- 查询联系人并解析收件人地址。
- 检索 Memo，将已有日报或资料作为邮件正文来源。

关键设计：

- 邮件工具通过当前 `user_id` 闭包构建，不允许 Agent 自行指定其他用户。
- 邮件列表返回内部可点击链接，但隐藏不适合直接展示的原始 ID。
- HTML 邮件先转换为可见文本，降低邮件内容中的 Prompt Injection 风险。
- 邮件签名由系统在发送时统一追加，Prompt 明确禁止模型再生成第二份签名。
- Graph 写操作异常保留为错误 Tool Message，供审批接口核验执行结果。

### 2. Contact Agent

负责维护 Personal Contact Relationship Brain：

- 搜索联系人身份和联系方式。
- 创建或补全联系人基本资料。
- 记录单条联系人事实。
- 从长聊天记录或会议记录中批量抽取联系人记忆。
- 返回联系人标签、画像事实、最近互动和事实来源。

联系人信息包含：

- 基础信息：姓名、公司、职位、地点、联系方式。
- 商务事实：合作历史、需求、痛点、预算、投资方向。
- 私人事实：兴趣、饮食、家庭、健康和生活习惯。
- 动态事实：近期事件、计划、会议和跟进事项。
- 互动时间线：事实产生的原始记录及日期。

### 3. Calendar Agent

负责：

- 查询日期区间内的日程。
- 根据“今天”“明天”“下周一”等自然语言查询单日事件。
- 创建和删除日程。
- 接受或拒绝日历邀请。

关键设计：

- 通过专门的日期解析工具处理相对日期和时区。
- 删除前要求先查询当天事件并选定唯一对象。
- 多个事件匹配时必须让用户确认具体条目。
- 创建、删除、接受和拒绝均经过 HITL。

### 4. Memos Agent

负责：

- 浏览最近的 Memo。
- 创建普通 Memo。
- 对 Memo 执行自然语言检索。
- 查询联系人，支持将人物信息和 Memo 联合使用。
- 使用 `track_area` 维护长期项目或生活领域。

`track_area` 以稳定名称执行 Upsert，同一领域后续更新不会生成大量重复记录。

### 5. GitHub Agent

负责：

- 获取用户选择的 GitHub 仓库当天 Commit。
- 根据真实提交记录生成工作日报。
- 将日报保存为 Work 类型 Memo。
- 当天没有 Commit 时明确返回无记录，不生成空日报。

## 八、Human-in-the-Loop 执行安全

Human-in-the-Loop 是 Friday 最能体现 Agent 工程化能力的模块之一。

### 1. 受保护操作

当前有 8 类高风险工具受到 LangChain HITL Middleware 保护：

1. 发送邮件。
2. 回复邮件。
3. 转发邮件。
4. 删除邮件。
5. 创建日历事件。
6. 删除日历事件。
7. 接受日历邀请。
8. 拒绝日历邀请。

### 2. 执行流程

```text
用户提出操作请求
        │
        ▼
Agent 生成最终 Tool Call
        │
        ▼
HumanInTheLoopMiddleware 中断 LangGraph
        │
        ▼
前端显示结构化审批卡片
        │
        ├── Reject：取消操作
        ├── Edit：修改允许字段
        └── Approve：恢复原图并执行工具
                │
                ▼
Command(resume={interrupt_id: decision})
                │
                ▼
验证 Tool Message 与实际执行状态
```

### 3. 结构性安全设计

- LangGraph Checkpoint 是唯一执行状态权威。
- 用户批准前，受保护工具在图中无法继续执行。
- 批准操作通过恢复原 Interrupt 执行，不存在第二套业务执行路径。
- 审计表只保存审批卡片展示信息，不决定工具是否能执行。
- 审批使用数据库原子 Claim，重复点击返回冲突而不是重复写入。
- 同一会话使用异步 Turn Lock，防止并发对话覆盖 Checkpoint。
- 执行后校验受批准工具是否返回可验证 Tool Message。
- 外部写入结果不确定时 Fail Closed，保留待对账状态，不允许盲目重试。
- 已完成、取消、失败和过期的审批记录刷新页面后仍可恢复。

### 4. 可编辑审批

邮件发送、回复和转发允许用户在审批卡片中修改部分字段：

- 收件人。
- 抄送人。
- 邮件主题。
- 邮件正文或转发评论。

后端只接受工具原参数及显式白名单字段，前端无法向工具调用注入任意未知参数。执行完成后，卡片展示实际执行的编辑后参数，而不是模型最初生成的草稿。

## 九、联系人关系大脑

### 1. 数据模型

关系记忆在 PostgreSQL 中拆分为：

- Contacts：联系人身份信息。
- Contact Profiles：离散画像事实。
- Contact Tags：标签。
- Contact Interactions：互动时间线和原始片段。

每条 Profile Fact 保存 `source_type` 与 `source_id`，可以回溯到聊天、邮件、Memo 或互动记录。

### 2. LLM 信息抽取

用户粘贴长聊天记录或会议内容后，Contact Brain Service 使用 LLM 抽取：

- 联系人基本信息。
- 一句话画像摘要。
- 联系人标签。
- 分维度画像事实。
- 本次互动摘要。

系统先创建互动记录，再让新事实指向这条互动，确保每条事实都具备来源证据。

### 3. 混合检索

联系人搜索采用分层策略：

1. PostgreSQL ILIKE 优先处理姓名、公司、职位、地点和字面事实。
2. 字面搜索无结果时，调用 Qdrant 语义检索。
3. Qdrant 同时执行 Dense Embedding 与 BM25 Sparse Vector 召回。
4. 使用 Reciprocal Rank Fusion 合并两路排序。
5. 根据命中的 `contact_id` 回查 PostgreSQL 完整联系人资料。

这一设计让数据库作为业务事实源，让向量数据库负责发现语义相关候选。

### 4. 可溯源增量索引

Qdrant 不是每个联系人一个大文档，而是每个来源行一个 Point：

- `identity` 对应联系人身份行。
- `profile` 对应单条画像事实。
- `interaction` 对应单条互动记录。

Point ID 直接使用 PostgreSQL Source Row ID，因此修改和删除事实时可以执行精确、幂等的向量更新，不需要重建整个人物档案。

### 5. 数据隔离与降级

- Dense 与 Sparse 两个查询分支都强制添加 `user_id` Filter。
- 返回结果时再次检查 Payload 中的 `user_id`，形成纵深防御。
- Sparse 模型不可用时降级到 Dense 检索。
- Qdrant 完全不可用时，联系人仍可通过 PostgreSQL 字面检索。
- 提供 Reindex 补偿接口，重新处理索引写入失败的行。

## 十、Memo RAG 与附件解析

### 1. Memo 检索链路

```text
用户自然语言问题
        │
        ▼
LLM Query Rewrite
        │
        ▼
Qdrant Dense + BM25 Prefetch
        │
        ▼
RRF Fusion
        │
        ├── Sparse 不可用：Dense-only
        └── Qdrant 失败/无结果：PostgreSQL Keyword Search
```

### 2. 稳定性设计

- Sparse Embedding 计算设置超时。
- Sparse 模型初始化失败后，在当前进程中自动关闭 Sparse 路径。
- Memo 数据库写入是事实源，向量索引采用 Best Effort。
- Qdrant 写入失败不会导致 Memo 丢失。
- 检索路径支持 Qdrant → PostgreSQL 多级降级。

### 3. 附件解析

支持解析：

- PDF：使用 pypdf 提取分页文本。
- DOCX：使用 python-docx 提取段落。
- TXT、Markdown、JSON、CSV 等文本。
- 图片：优先使用阿里云 OCR，失败后使用视觉模型。

附件解析文本会参与 Memo 向量化和检索，使图片、报告和文档中的内容也可以通过自然语言找到。

## 十一、邮件与外部系统集成

### 1. Microsoft Graph

用于：

- Outlook 邮件。
- Outlook 日历。
- Microsoft 联系人同步。
- Azure OAuth Provider Token 存储和刷新。

Graph Client 实现 Token Refresh-and-Retry：访问令牌失效后尝试刷新并重试请求，降低用户频繁重新登录的成本。

### 2. 通用 IMAP/SMTP

项目还实现了通用邮箱服务层：

- IMAP 邮件读取、搜索、线程和文件夹操作。
- SMTP 异步发送。
- 多邮箱账户和 Provider 配置。
- 邮箱凭据 Fernet 加密存储。
- 自定义邮箱 Host 的 SSRF 校验。
- 同步 IMAP 调用通过线程池执行，避免阻塞 FastAPI Event Loop。

当前 Agent 邮件工具主要使用 Microsoft Graph；通用 IMAP/SMTP 是产品邮箱模块的另一条能力链路，简历中不应混写成“Agent 已统一支持所有邮箱”，除非后续代码已经完成接入。

### 3. GitHub

- 通过 GitHub OAuth 获取授权。
- 支持选择多个仓库。
- 拉取当天 Commit Activity。
- 将 Commit Message 转换为日报并保存到 Memo。

## 十二、前端 Agent 交互设计

前端基于 React 19、Vite、React Router 和 TanStack Query 构建。

### 1. 统一工作台

主要页面包括：

- Dashboard
- Email
- Calendar
- Chat
- Memos
- Contacts
- Settings

### 2. SSE Agent Chat

前端通过 Async Generator 消费 SSE，并将事件转换为显式状态机 Transition。

后端返回的主要事件包括：

- `chunk`：模型增量内容。
- `tool_call`：工具运行或完成状态。
- `final_message`：Checkpoint 中的权威最终回答。
- `preview`：会话列表预览。
- `pending_actions`：审批卡片数据。
- `title`：自动生成的会话标题。
- `[DONE]`：流式结束。

### 3. 流式文本与权威结果分离

流式 Chunk 只用于打字动画。页面最终展示内容以 LangGraph Checkpoint 投影出的 `final_message` 为准，避免：

- 流式片段重复。
- 子 Agent 中间输出被误当作最终回答。
- 页面实时内容与刷新后历史不一致。
- 中断流程清空已经展示的内容。

### 4. 审批卡片

后端决定：

- 使用哪种卡片 Renderer。
- 卡片放在什么消息之后。
- 哪些字段可以编辑。
- 允许批准、编辑还是拒绝。
- 操作属于普通还是危险类型。

前端只根据可信结构化 Payload 展示和收集决定，不自行判断某项操作是否可以执行。

### 5. 国际化与个性化

- 使用 react-i18next 提供中英文界面。
- 支持自定义助手名称、头像和表达偏好。
- 用户语言和回复偏好可以通过长期记忆注入各 Agent。

## 十三、可靠性、安全性与工程化

### 1. 身份与数据隔离

- 使用 Supabase Auth 与 Microsoft Azure Provider 登录。
- FastAPI Route 通过依赖注入获取当前 `user_id`。
- Agent 工具在构建时闭包绑定当前用户，不暴露 `user_id` 给模型填写。
- PostgreSQL 和 Qdrant 查询都按用户进行隔离。

### 2. Prompt Injection 防护

- 邮件 HTML 清洗为可见文本。
- Agent Prompt 明确将邮件、Memo、联系人、日历和外部系统内容视为不可信数据。
- 外部内容只作为数据使用，不能覆盖系统规则。
- 回答要求基于工具返回，不允许在检索无结果时编造信息。

### 3. 会话与执行状态

- 使用 `langgraph-checkpoint-postgres` 持久化 Agent 对话状态。
- Checkpoint Schema 与业务 Alembic Migration 分离维护。
- 每个 Session 使用独立 Thread ID。
- Process 内 Session Turn Lock 串行化同会话请求。
- 跨审批请求通过数据库原子 Claim 防止重复执行。

### 4. 模型接入

提供统一 LLM Provider 配置，支持：

- Qwen。
- Zhipu GLM。
- 自定义 OpenAI-compatible Endpoint。
- 自定义 Chat Model、Embedding Model 和 Vision Model。

模型调用统一经 `make_chat_model` 创建，减少各模块单独配置产生的漂移。

### 5. 可观测性

- 可选接入 Langfuse tracing。
- 以 Session ID 和 User ID 标记 Agent Run。
- Tracing 初始化失败时降级为无追踪，不影响用户对话。
- 提供 Team Info 调试接口，查看实际 Supervisor Prompt、Agent Prompt 和工具描述。
- 支持 LangGraph Studio 调试 Agent Graph。

### 6. 数据库与迁移

- PostgreSQL 统一保存业务数据和 LangGraph Checkpoint。
- 使用共享异步 psycopg Pool。
- 业务表通过 Alembic 独立迁移。
- Checkpointer 维护自己的 Migration 版本。
- 应用启动只检查业务 Schema 版本，不自动修改业务表。

### 7. CI 与测试

GitHub Actions 在 Push 和 Pull Request 中执行后端 Smoke Test，以及前端 Lint、Test 和 Build。

## 十四、Agent 评测体系

### 1. Agent Behavior Eval

使用真实 Agent Graph 和真实 Prompt/Tool Schema，但将工具函数体替换为 Stub，从而在不连接 PostgreSQL、Qdrant、Microsoft Graph 和 GitHub 的情况下评测：

- Agent 路由准确性。
- Required Tool Recall。
- Forbidden Tool Call。
- Unwanted Write Rate。
- 最终回答是否符合 Rubric。
- LLM Judge 通过率。

评测会生成独立 HTML 报告，展示每个 Case 的：

- 用户问题。
- Agent 委派链路。
- 工具调用链。
- 最终回答。
- 失败原因。

### 2. Contact Retrieval Eval

联系人 RAG 具有独立 Goldset 和离线评测脚本，指标包括：

- Recall@K。
- Mean Reciprocal Rank。
- No-result Rate。
- Wrong Top-1 Rate。

Wrong Top-1 被单独统计，因为在关系管理场景中，自信地返回错误联系人通常比没有结果风险更高。

### 3. 当前代码中的评测规模

- Agent Behavior Goldset：20 个 Case。
- Contact Retrieval Goldset：5 个联系人、16 个查询。
- 后端测试目录：18 个 `test_*.py` 文件，静态统计约 98 个测试方法。
- 前端：48 个测试文件，静态统计约 207 个测试用例。

以上数字用于描述当前代码规模，不代表在任意环境中都已经全部通过。写入简历前应结合对应 Commit 和 CI 结果确认。

## 十五、主要技术难点与解决方案

### 难点一：多 Agent 共享历史导致上下文污染

问题：共享消息状态会让子 Agent 看到其他领域的 Tool Call、历史中间回答和无关内容，增加 Token、错误工具选择和供应商兼容问题。

解决方案：

- 将领域 Agent 改为 Parent Agent 的委派工具。
- 每次只传递一条自包含任务。
- Parent Agent 负责解析代词和日期。
- 子 Agent 只拥有所属领域工具。

### 难点二：大模型不能作为外部写操作的唯一执行权威

问题：仅靠 Prompt 让模型“先询问用户”无法确保邮件和日历操作一定暂停。

解决方案：

- 使用 HumanInTheLoopMiddleware 在图结构中中断工具。
- 使用 Checkpoint 保存 Interrupt。
- 用户决定通过 `Command(resume)` 恢复原执行图。
- 使用数据库 Claim 处理重复批准。
- 审批后验证 Tool Message 是否真实成功。

### 难点三：外部写操作可能已经发生但响应丢失

问题：Microsoft Graph 已完成写入后，如果网络或 Checkpoint 更新失败，系统无法简单判断能否重试。

解决方案：

- 对不确定结果采用 Fail Closed。
- 将审批记录保留为需对账状态。
- 不允许盲目重试可能已经发生的外部副作用。
- 执行日志和展示审计与执行权威分离。

### 难点四：实时流式输出与刷新后历史可能不一致

问题：SSE Chunk 可能包含重复片段、子 Agent 中间输出，或来自最终未采用的 Graph 分支。

解决方案：

- Chunk 仅用于实时动画。
- 最终回答统一从 Checkpoint 可见消息投影生成。
- 会话历史和实时最终结果复用同一投影逻辑。

### 难点五：关系记忆需要同时支持精确查询与模糊描述

问题：姓名和公司适合结构化匹配，“喜欢普洱茶的投资人”更适合语义检索。

解决方案：

- PostgreSQL 字面查询优先。
- 无直接结果时使用 Qdrant Dense + BM25。
- 使用 RRF 融合排序。
- 命中后回查 PostgreSQL 完整资料和来源证据。

### 难点六：向量索引不能成为业务数据单点

问题：Embedding API 或 Qdrant 异常不应导致用户的 Memo 或联系人事实写入失败。

解决方案：

- PostgreSQL 作为业务事实源。
- 向量索引采用 Best Effort。
- 搜索支持 Dense 和 PostgreSQL 降级。
- 联系人索引提供增量 Reindex 补偿任务。

### 难点七：用户数据和外部凭据高度敏感

解决方案：

- 支持自托管。
- 使用 Supabase Auth 隔离用户。
- Qdrant Filter 与返回后二次检查。
- IMAP/SMTP 凭据使用 Fernet 加密。
- 自定义邮箱地址执行 SSRF 防护。
- 高风险操作统一经过审批。

## 十六、技术栈

### AI Agent

- LangGraph
- LangChain
- Agents-as-Tools
- Supervisor / Parent Agent
- Tool Calling
- Human-in-the-Loop
- LangGraph Interrupt / Command Resume
- PostgreSQL Checkpoint
- Prompt Engineering
- Agent Evaluation
- LLM Judge

### RAG 与模型

- Qdrant
- Dense Embedding
- FastEmbed BM25 Sparse Embedding
- Reciprocal Rank Fusion
- Query Rewrite
- Hybrid Retrieval
- OpenAI-compatible API
- Qwen
- Zhipu GLM
- Vision LLM

### 后端

- Python 3.12
- FastAPI
- Pydantic
- psycopg async pool
- PostgreSQL
- Alembic
- SSE
- Microsoft Graph API
- GitHub API
- IMAPClient
- aiosmtplib
- Supabase

### 前端

- React 19
- Vite
- React Router
- TanStack Query
- Fluent UI
- react-i18next
- React Markdown
- Vitest
- Testing Library

### 工程化

- Docker Compose
- GitHub Actions
- Langfuse
- LangGraph Studio
- Ruff
- oxlint
- Pytest / unittest

## 十七、简历可直接使用版本

### 版本 A：偏 AI Agent 应用开发

**Friday｜自托管多 Agent 个人 AI 工作台**

基于 LangGraph、LangChain、FastAPI 和 React 构建面向个人关系管理的多 Agent 工作台，通过 Parent Agent 协调邮件、联系人、日历、备忘录和 GitHub 五个隔离领域 Agent，并结合混合检索、长期记忆和 Human-in-the-Loop 实现可追溯、可审核的个人 AI 助理。

- 设计 Parent Agent + 5 个领域 Agent 的 Agents-as-Tools 架构，由顶层 Agent 完成人物、代词和日期解析，再将自包含任务委派给隔离子 Agent，减少跨领域上下文污染和无关 Token 输入。
- 基于 LangGraph Checkpoint 与 LangChain HumanInTheLoopMiddleware 构建 8 类高风险操作审批链路，在邮件和日历工具执行前暂停 Graph，支持编辑、批准、拒绝及恢复执行。
- 构建联系人关系大脑，将聊天记录和随手记抽取为身份、标签、画像事实及互动时间线，并为每条事实保存来源信息，实现关系记忆的持续更新与证据回溯。
- 基于 PostgreSQL 字面查询和 Qdrant Dense+BM25/RRF 混合召回实现联系人及 Memo 检索，并设计 Sparse→Dense→PostgreSQL 多级降级与增量 Reindex 补偿机制。
- 设计 SSE Agent 事件协议和权威消息投影，将模型增量输出、工具状态、最终回答、审批动作及会话标题实时同步至前端，并保持刷新前后展示一致。
- 建立 Agent Behavior 与 Contact Retrieval 评测体系，覆盖路由准确率、工具召回、非预期写入率、LLM Judge、Recall@K、MRR 和 Wrong Top-1 Rate。

### 版本 B：偏 RAG 与关系记忆

**Friday｜AI 关系大脑与个人知识检索系统**

- 使用 LLM 从聊天记录、会议内容和随手记中抽取联系人身份、业务背景、偏好、近期事件和互动摘要，持久化为规范化 PostgreSQL 关系数据。
- 设计 Source Row 级可溯源向量索引，将联系人身份、画像事实和互动分别写入 Qdrant Point，支持事实级增量修改、删除和来源引用。
- 构建 PostgreSQL + Qdrant 混合检索链路，对姓名、公司等精确信息优先执行结构化匹配，对自然语言描述使用 Dense+BM25/RRF 语义召回。
- 为 Memo 构建 Query Rewrite、Dense/Sparse 混合召回、Dense-only 与 PostgreSQL Keyword Fallback，保证向量服务异常时核心数据仍可查询。
- 建立联系人检索 Goldset，以 Recall@K、MRR、No-result Rate 和 Wrong Top-1 Rate 衡量中文及混合查询效果。

### 版本 C：偏 AI Agent 全栈开发

**Friday｜多 Agent 个人执行工作台**

- 使用 FastAPI、LangGraph 和 PostgreSQL 开发多 Agent 后端，构建领域路由、工具调用、长期记忆、Checkpoint 持久化和审批恢复能力。
- 使用 React、Vite 和 TanStack Query 开发 Chat、Email、Calendar、Memos、Contacts 和 Dashboard 等工作台模块。
- 通过 SSE 实时展示 Agent 回答和工具状态，并开发可编辑审批卡片处理邮件、日历等高风险动作。
- 集成 Microsoft Graph、GitHub OAuth、Supabase Auth、Qdrant、通用 IMAP/SMTP、阿里云 OCR 和视觉模型。
- 使用 Docker Compose、Alembic、GitHub Actions 和 Langfuse 完成数据迁移、自动化检查、部署及 Agent 可观测性建设。

### 版本 D：简洁版

**Friday｜自托管多 Agent 个人 AI 工作台**

基于 LangGraph、FastAPI 和 React 构建个人 AI 关系工作台，通过 Parent Agent 调度邮件、联系人、日历、备忘录和 GitHub 五个专业 Agent；结合 PostgreSQL/Qdrant 混合检索、长期记忆、SSE 流式交互和 LangGraph HITL 审批，实现关系信息沉淀、自然语言检索及高风险业务操作的可控执行。

## 十八、可组合的简历 Bullet 素材

根据个人真实职责挑选 4—6 条，不要全部使用。

### Multi-Agent 架构

- 设计 Parent–Specialist 分层 Agent 架构，将邮件、联系人、日历、备忘录和 GitHub 能力拆分为隔离领域 Agent。
- 将子 Agent 封装为 Parent Agent 的委派工具，由 Parent 负责上下文解析、子 Agent 负责限定领域执行。
- 建立 Slash Command 直达与 Supervisor 自动路由双入口，并统一写入同一 LangGraph Checkpoint。
- 对 Parent Agent 输入进行 Token 上限裁剪，同时保留 PostgreSQL 中的完整会话历史。
- 将当前用户、助手名称、邮件签名和长期记忆注入 Agent 构建过程，支持跨会话个性化。

### Human-in-the-Loop

- 使用 LangChain HumanInTheLoopMiddleware 拦截邮件和日历高风险 Tool Call，在 Graph 层保证批准前无法执行。
- 基于 LangGraph Interrupt 与 Command Resume 实现审批后原图恢复，避免审批逻辑与业务执行逻辑形成两套状态机。
- 设计可编辑审批卡片，并通过字段白名单限制客户端可修改参数。
- 使用数据库原子 Claim 和会话锁防止重复批准、并发 Checkpoint 覆盖及重复外部写入。
- 对外部执行结果进行 Tool Message 验证，对结果不确定的副作用 Fail Closed 并进入对账状态。

### RAG 与长期记忆

- 构建 Qdrant Dense+BM25 双路召回与 RRF 融合链路，支持 Sparse 失败后的 Dense-only 降级。
- 设计 PostgreSQL 优先、向量检索补充的联系人召回策略，兼顾姓名精确查询与自然语言模糊描述。
- 将联系人身份、事实和互动按 Source Row 建立独立向量 Point，实现细粒度幂等更新与来源追溯。
- 为 Memo 设计 Query Rewrite、混合向量召回和 PostgreSQL Keyword Fallback。
- 建立用户 Profile、Preference 和 Topic 三级长期记忆，并通过稳定 Key Upsert 避免矛盾记忆累积。

### 外部系统与安全

- 集成 Microsoft Graph，实现 Outlook 邮件、日历和联系人同步，并设计 Access Token 刷新重试。
- 集成 GitHub OAuth 与 Commit 查询，基于真实提交记录自动生成并保存工作日报。
- 开发通用 IMAP/SMTP 邮箱服务，支持多 Provider、凭据加密、SSRF 防护和线程池隔离。
- 对 HTML 邮件进行可见文本清洗，并将外部内容统一视为不可信数据，降低 Prompt Injection 风险。
- 在 Agent Tool 构建时闭包绑定当前用户身份，避免模型通过参数访问其他用户数据。

### 前端与流式交互

- 设计 SSE Agent Chat 状态机，处理增量文本、工具状态、最终回答、审批动作和会话元数据。
- 将实时 Chunk 与最终权威消息分离，统一从 Checkpoint 投影生成可持久化回答，保证刷新前后显示一致。
- 开发邮件、回复、转发和日历专用审批预览组件，支持结构化参数编辑和执行状态恢复。
- 使用 TanStack Query 统一管理邮件、联系人、日历、Memo 和设置等服务端状态。
- 使用 react-i18next 构建中英文双语体验，并支持助手名称、头像和回复风格个性化。

### Eval 与工程化

- 建立真实 Graph + Stub Tool 的 Agent 行为评测 Harness，隔离外部依赖并保留真实 Prompt、Tool Schema 和路由逻辑。
- 设计 Routing Accuracy、Required Tool Recall、Unwanted Write Rate 和 LLM Judge 等多维 Agent 指标。
- 构建联系人检索 Goldset 和 Recall@K/MRR 评测脚本，重点监控 Wrong Top-1 风险。
- 使用 PostgreSQL Checkpoint、Langfuse 和 LangGraph Studio 提升 Agent 状态持久化、追踪与调试能力。
- 配置 GitHub Actions 执行后端 Smoke Test 与前端 Lint、Test、Build 检查。

## 十九、面试讲述版本

### 1 分钟版本

Friday 是一个开源、自托管的个人 AI 关系工作台，主要解决用户在邮件、联系人、日历和笔记之间切换，以及关系上下文难以持续维护的问题。

系统采用 Parent Agent 加五个领域子 Agent 的架构，分别处理邮件、联系人、日历、备忘录和 GitHub。Parent Agent 负责理解用户请求并把已经解析人物和日期的自包含任务委派给子 Agent，子 Agent 只拥有自己的工具，因此可以减少上下文污染和越界调用。

项目中最重要的两个工程点是关系记忆和操作安全。关系记忆使用 PostgreSQL 保存联系人、事实和互动来源，Qdrant 负责 Dense+BM25 混合检索；邮件发送和日历变更则使用 LangGraph HITL，在工具执行前暂停 Graph，用户通过审批卡片确认后再恢复原流程。前端使用 SSE 展示模型输出、工具状态和审批动作，最终答案统一以 Checkpoint 状态为准，保证实时页面和刷新后的历史一致。

### 3 分钟讲述结构

1. 产品问题：传统通讯录只存静态字段，关系上下文和跟进线索分散在多个系统。
2. 产品目标：建立可持续沉淀、可自然语言检索、可以安全执行动作的个人关系大脑。
3. Agent 架构：Parent Agent + 5 个隔离领域 Agent。
4. 核心数据：联系人身份、画像事实、互动时间线、Memo 和用户长期记忆。
5. 检索链路：PostgreSQL 字面查询 + Qdrant Dense/BM25/RRF。
6. 安全机制：LangGraph Interrupt、审批卡片、Command Resume、Atomic Claim。
7. 前端交互：SSE Chunk、工具活动、权威最终消息和审批恢复。
8. 评测方式：Agent Behavior Goldset 与 Contact Retrieval Goldset。
9. 工程化：Supabase Auth、PostgreSQL Checkpoint、Langfuse、CI 和自托管部署。

## 二十、适合 ATS 的关键词

`AI Agent`、`Multi-Agent System`、`LangGraph`、`LangChain`、`Agents-as-Tools`、`Agent Orchestration`、`Tool Calling`、`Human-in-the-Loop`、`LangGraph Interrupt`、`Command Resume`、`Checkpoint`、`Prompt Engineering`、`Agent Evaluation`、`LLM Judge`、`RAG`、`Hybrid Retrieval`、`Dense Embedding`、`BM25`、`RRF`、`Qdrant`、`Long-term Memory`、`SSE`、`FastAPI`、`PostgreSQL`、`React`、`Microsoft Graph`、`Supabase`、`GitHub OAuth`、`Docker`、`Langfuse`

## 二十一、需要补充的个人信息

要把本文转化为有说服力的个人项目经历，还需要补充：

- 你在项目中的角色和参与时间。
- 哪些模块是你从零设计或主导重构的。
- 当前公开用户数、活跃用户数或实际部署数量。
- 已接入的邮箱、联系人和 Memo 数据规模。
- Agent 路由准确率和行为评测实际结果。
- Contact Retrieval 的 Recall@K、MRR 和 P95 延迟。
- HITL 审批成功率、失败率和重复执行事故数。
- 从旧架构迁移到 Agents-as-Tools 后的 Token、延迟或错误率变化。
- 上线前后关系信息录入、邮件处理或会议准备时间变化。
- 是否可以公开 GitHub、在线 Demo 或架构图。

在没有实测数据前，不要将设计估算写成已经实现的业务提升。

## 二十二、关键代码依据

- 项目说明：[`README.md`](../README.md)
- 当前 Agent 架构：[`backend/app/agents/supervisor.py`](../backend/app/agents/supervisor.py)
- 路由策略：[`backend/app/agents/routing.py`](../backend/app/agents/routing.py)
- HITL 策略：[`backend/app/agents/hitl.py`](../backend/app/agents/hitl.py)
- Agent API 与 SSE：[`backend/app/api/agent.py`](../backend/app/api/agent.py)
- Agent 工具：[`backend/app/agents/tools.py`](../backend/app/agents/tools.py)
- PostgreSQL Checkpoint：[`backend/app/agents/checkpointer.py`](../backend/app/agents/checkpointer.py)
- 会话并发锁：[`backend/app/agents/turn_lock.py`](../backend/app/agents/turn_lock.py)
- Qdrant 混合检索：[`backend/app/infrastructure/vector/qdrant.py`](../backend/app/infrastructure/vector/qdrant.py)
- 联系人关系抽取：[`backend/app/services/contact_brain_service.py`](../backend/app/services/contact_brain_service.py)
- 通用邮箱服务：[`backend/app/services/mail_provider_service.py`](../backend/app/services/mail_provider_service.py)
- 文档与图片解析：[`backend/app/services/document_parser.py`](../backend/app/services/document_parser.py)
- 前端 Agent Stream：[`frontend/src/features/chat/useAgentChatStream.js`](../frontend/src/features/chat/useAgentChatStream.js)
- 前端审批状态：[`frontend/src/features/chat/useChatApprovals.js`](../frontend/src/features/chat/useChatApprovals.js)
- Agent 行为评测：[`backend/tests/eval_agent_behavior.py`](../backend/tests/eval_agent_behavior.py)
- 联系人检索评测：[`backend/tests/eval_contacts_retrieval.py`](../backend/tests/eval_contacts_retrieval.py)

