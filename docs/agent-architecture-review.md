# Agent 架构审查：头大脚轻问题

审查日期：2026-08-19
审查范围：`backend/app/agents/`（2978 行）+ `backend/app/api/agent.py`
结论：**存在明显的头大脚轻，且防护层的重量分布与实际风险成反比。**

---

## 一、体量数据

| 层 | 体量 |
|---|---|
| agent 系统提示词（5 个 domain agent） | 6,001 字符 |
| supervisor 提示词 + `_ROUTING_HINTS` | 3,484 字符 |
| 工具 docstring（同样进入提示词） | 6,725 字符 |
| **自然语言指令合计** | **≈16.2k 字符** |
| 意图分类正则 | 9 个，分散在 3 个文件 |
| 关键词表 | 1 张（`_DOMAIN_KEYWORDS`） |

各 agent 的提示词与工具数对比：

| agent | 工具数 | docstring 字符 | 系统提示词字符 |
|---|---|---|---|
| contact_agent | 4 | **3,140** | 1,046 |
| mail_agent | 8 | 1,472 | 1,742 |
| memos_agent | 4 | 946 | 745 |
| calendar_agent | 6 | 848 | 1,649 |
| github_agent | 2 | 319 | 819 |

`contact_agent` 工具最少（4 个），docstring 却是全项目最多（3,140 字符）——工具越少、提示词越长，本身就是边界没划清的信号。

---

## 二、头重的三个表现

### 问题 1：防护层数与实际风险成反比 ⚠️ 最严重

| 域 | 写操作性质 | 防护机制 | 层数 |
|---|---|---|---|
| 邮件 / 日历 | **不可逆**、外部副作用 | HITL interrupt（`hitl.py`） | **1 层，结构性** |
| memos / contacts | 可逆、本地 | routing 正则 → `tool_choice` 强制 → `_strip_foreign_tool_pairs` → `_drop_historical_ai_text` → 输出正则 `verify_*_claims` | **5 层，全启发式** |

风险最低的域堆了最多层。

关键差异在于**结构性 vs 启发式**：
- HITL 之所以只需要一层，是因为 LangGraph checkpoint 是唯一执行权威——工具在人类批准前**物理上无法执行**。
- contacts / memos 没有任何等价的结构保证，只能靠提示词 + 正则 + `tool_choice` 层层加码。而这 5 层里已有两层被证明会被供应商静默忽略（见问题 4）。

相关代码：`app/agents/hitl.py`、`app/agents/context.py`、`app/agents/routing.py`

### 问题 2：三对近似重复的双胞胎

| memos 侧 | contacts 侧 | 差异 |
|---|---|---|
| `memo_tool_choice` | `contact_tool_choice` | 仅正则不同 |
| `RequireMemosToolMiddleware` | `RequireContactToolMiddleware` | 仅类名 + 调用的 choice 函数不同 |
| `verify_memo_claims` | `verify_contact_claims` | 仅正则 + handoff 目标不同 |

共约 120 行近似重复代码（`context.py`）。

**已经造成实际损失**：2026-08-19 修复 contact 侧的 "`tool_choice` 具名被供应商忽略" bug 时，memos 侧同一个 bug 未修——`memo_tool_choice` 目前仍返回具名的 `"create_memo"`（`context.py:221`），大概率同样失效。复制粘贴的防护层意味着每个 bug 都要修两遍，且必然漏一遍。

### 问题 3：同一个意图分类问题被切成两半、分放两处

| 位置 | 正则 | 职责 |
|---|---|---|
| `routing.py` | `_CONTACT_WRITE_RE`、`_CONTACT_LOOKUP_RE` | 判断"用户想写还是想查" |
| `context.py` | `_CONTACT_SAVE_CLAIM_RE` | 判断"模型是否假称已保存" |

两者是同一个意图分类问题的两半，却分在两个文件、用两套独立词表。任何一句新措辞要同时更新两处才不漏。memos 侧（`_MEMO_WRITE_RE` / `_MEMO_SAVE_CLAIM_RE`）同构。

---

## 三、脚轻的证据

### 问题 4：schema 能强制的约束，交给了自然语言

`app/agents/tools.py:332-376` — `record_contact_fact`：

```python
async def record_contact_fact(
    contact_name: str,
    dimension: str,      # ← 实际是 4 值枚举
    category: str,       # ← 实际是 7 值枚举
    ...
):
    # 合法取值靠 1,046 字符 docstring 用自然语言告诉模型
    dim_clean = dimension.strip().lower()
    if dim_clean not in ("basic", "business", "private", "dynamic"):
        dim_clean = "private"        # ← 静默强转
    cat_clean = category.strip().lower()
    if cat_clean not in ("preference", "pain_point", ...):
        cat_clean = "other"          # ← 静默强转
```

后果：模型猜错 → 事实被悄悄写进错误维度 → 无任何告警。

`Literal[...]` 可以让 schema 在供应商侧直接强制，docstring 里那段枚举说明可以删掉，静默强转也不必存在。这是最典型的"该由脚承担的重量压在头上"。

### 问题 5：工具边界重叠 → 提示词被迫充当裁判

`contact_agent` 的 4 个工具职责互相重叠：

- `create_contact` — 名义是 create，实际是 upsert（按 name 匹配后 update）
- `record_contact_fact` — 记录单条事实，但联系人不存在时会自动创建
- `extract_contact_memory` — 上面两件事都做，外加 tags/timeline，且**自己内部再调一次 LLM**（`contact_brain_service.py`）
- `search_contacts` — 只读查询

直接后果：`tools.py` 中出现 **7 处** `WHEN TO USE` / `Do NOT use ... use X instead` 的纯仲裁文字。工具边界划不清，就只能让提示词去裁判该用哪个。

附带问题：`extract_contact_memory` 构成 agent → tool → LLM 的嵌套 LLM 调用，成本与延迟不可见。

---

## 四、供应商 workaround 未集中标注

当前 LLM 配置（`backend/.env`）：

```
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
OPENAI_MODEL=glm-4-flash
```

已实测确认的两个供应商不合规行为，以及为此写的 workaround：

| 供应商行为（已实测） | workaround | 位置 |
|---|---|---|
| `tool_choice` 指定具体函数名被静默忽略（只认 `required`/`auto`/`none`） | 改用 `"required"` | `context.py` `contact_tool_choice` |
| 上下文末尾存在"外来工具"（本 agent 未绑定的 `transfer_to_*`）的 ToolMessage 时，`tool_choice` 完全失效 | `_strip_foreign_tool_pairs` | `context.py:325` |
| 历史中堆积多轮纯文字 AI 回复后，`tool_choice="required"` 被无视，模型照抄纯文字模式 | `_drop_historical_ai_text` | `context.py:300` |
| 回放历史中的 `name` 字段导致 400 | `_ProxyCompatChatOpenAI` | `supervisor.py:32` |

问题：前三个以 middleware 内部函数形态散落在 `context.py`，只有第四个有明确的 `ponytail:` 注释说明"何时可以删"。半年后没人知道前三个为什么存在，也不敢删——尤其是换掉模型/代理之后。

---

## 五、建议（按性价比排序）

1. **`Literal` 换掉 `record_contact_fact` 的 `dimension: str` / `category: str`，删掉静默强转**
   纯粹的重量下移，几行改动，省数百字符提示词，错值从静默污染变为可见错误。

2. **三对双胞胎抽成一个参数化的表**（域 → 工具集 / 正则 / handoff 目标）
   顺带修掉 memos 侧还没修的 `tool_choice` 具名 bug（问题 2）。

3. **合并 `record_contact_fact` 与 `extract_contact_memory`**
   两者都是"从文本抽事实"，只差数量。合并后可删掉 7 处仲裁文字。

4. **把 4 个供应商 workaround 集中到一处并标注**（例如 `app/agents/provider_quirks.py`），每个注明实测现象与删除条件。

5. **不要再加第 6 层启发式。** contacts / memos 若真需要执行保证，方向应是引入结构性机制（类似 HITL 的"tool 结果是唯一权威"），而不是继续叠加提示词与正则。

---

## 附：本次审查中顺手修掉的 bug（已完成，非待办）

2026-08-19，同一轮对话中发现并修复的三层 contact 记录失效问题：

1. **路由层** — supervisor 只认"显式问人 / 显式建联系人"两种句式，认不出"叙述已知人物新情况"（`他上周五考了个证`），落到 memos_agent。修：`_ROUTING_HINTS` + supervisor prompt 补第三类触发描述。
2. **强制层** — `contact_tool_choice` 仅在显式 create 时强制工具，其余靠提示词自觉；且具名 `tool_choice` 被供应商忽略。修：新增 `is_contact_lookup_request` 区分问/说，非提问一律 `"required"`。
3. **上下文层** — 上述两个供应商 quirk（外来工具尾巴、长历史纯文字回复）导致 `required` 也失效。修：`_strip_foreign_tool_pairs` + `_drop_historical_ai_text`。

验证方式：一次性 user_id 重放真实 5 轮对话，直查 `contact_profiles` 表（不信任模型自述）。结果 3 条事实全部正确落库。测试：`backend/tests/test_contact_routing.py`（9 条）。

---

# 附录二：对照 LangChain 官方最佳实践的架构分析

分析日期：2026-08-19
参照版本（本项目实装）：`langchain 1.3.11` / `langchain-core 1.4.8` / `langgraph 1.2.7` / `langgraph-supervisor 0.0.31`

## 结论

前面五个问题都是**症状**。根因是一个架构选型问题：

> 在 LangChain 官方的五种 multi-agent 模式里，本项目选了上下文累积最严重的 **Handoffs**，
> 然后用 471 行 `context.py` 手工补偿它——而这正是 **Subagents** 模式免费提供的能力。

## 一、模式选型：Handoffs vs Subagents

LangChain 官方 multi-agent 文档现在描述五种模式：**Subagents / Handoffs / Skills / Router / Custom workflow**。
（注：`langgraph-supervisor` 并未被标记废弃，但已不再是官方文档主推的模式；其版本号仍停留在 `0.0.31`。）

| | Subagents | Handoffs ← **本项目** |
|---|---|---|
| 子 agent 形态 | 主 agent 把子 agent 当**工具**调用 | `transfer_to_*` 转移控制权 |
| 消息状态 | **每个子 agent 独立上下文** | **共享持久 state** |
| 上下文趋势 | 强隔离，按需传入 | 随对话累积 |
| 官方给出的多域任务实测 | ~9K tokens | ~14K+ tokens |
| 适用 | 并行执行、大上下文域 | 多跳、直接交互 |

判定依据（本项目确实是 Handoffs）：`supervisor.py` 使用 `create_handoff_tool` + `create_supervisor`，
子 agent 与 supervisor 共享同一个 `messages` 通道，并有 `transfer_back_to_supervisor` 回传。

### 关键推论：今天修的每一个 bug 都是 Handoffs 共享状态的必然症状

| 今天的修复 | 为什么在 Handoffs 下必然出现 | Subagents 下是否存在 |
|---|---|---|
| `_strip_foreign_tool_pairs` | 子 agent 在自己的上下文里看到了 supervisor 的 `transfer_to_contact_agent` ToolMessage——共享 `messages` 的直接后果 | **不存在**（子 agent 有独立消息列表，根本看不到 handoff 记录） |
| `_drop_historical_ai_text` | 历史 AI 纯文字回复无限累积，侵蚀 `tool_choice` 遵守度 | **大幅减轻**（每次调用只传入本次任务所需上下文） |
| `_safe_text_messages` 的注释"历史 tool message 不能单独包含，OpenAI 协议要求配对的 assistant tool call" | 只有在需要从共享历史里挑消息投影时才会遇到 | **不存在** |

也就是说：`context.py` 里 471 行中的绝大部分，是为了补偿模式选型带来的上下文污染。

## 二、已内置却手写了的 middleware

本项目实装的 `langchain 1.3.11` 在 `langchain.agents.middleware` 下导出 30+ 个符号，
但项目只用了 `HumanInTheLoopMiddleware`（`hitl.py`，用得对）+ `AgentMiddleware`/`ModelRequest`（写自己的）。

| 项目手写 | 官方内置（已装、未用） | 说明 |
|---|---|---|
| `_trim_history`（`supervisor.py:127`，`trim_messages` 20k） | `SummarizationMiddleware` | 官方版本明确保证"AI/Tool 消息配对不被切开"。项目手写的 `start_on="human", end_on=("human","tool")` 正是在手工模拟这一点，而 `_safe_text_messages` 的注释证明已经踩过配对被切开的坑 |
| `_strip_foreign_tool_pairs` + `_drop_historical_ai_text`（今天新增，共 ~50 行） | ~~`ContextEditingMiddleware`~~ **无替代** | **已核实：不等价。** `ClearToolUsesEdit.apply()` 只在超过 token 阈值时把旧 **tool 结果内容**替换为占位符（消息保留原位），既不删 handoff 配对，也完全不碰 AI 纯文字。两个手写函数必须保留 |
| 无对应 | ~~`ModelFallbackMiddleware`~~ **不适用** | **已核实：不适用。** 源码是 `try: handler(request) except Exception` —— 只在**抛异常**时切换模型。而 `tool_choice` 不被遵守是**静默成功**（HTTP 200 + 合法 AIMessage + 无 tool call），永远不触发 fallback |
| 无对应 | **`ToolCallLimitMiddleware`** | 今天的 trace 里出现过 `forced_contact_verify_*` 触发的二次 handoff（同一轮内 contact_agent 被调用两次），当前没有任何调用次数上限 |
| contact_agent 4 个职责重叠工具靠 docstring 仲裁（问题 5） | `LLMToolSelectorMiddleware(max_tools=..., always_include=[...])` | 用 LLM 先筛工具，而不是把仲裁逻辑写进 3,140 字符的 docstring |
| 无对应 | `ModelRetryMiddleware` / `ModelCallLimitMiddleware` / `PIIMiddleware` / `TodoListMiddleware` | 视需要 |

## 三、`tool_choice` 强制本身就是在用错工具解决问题

`langchain/agents/factory.py:1388`：

```python
tool_choice = "any" if structured_output_tools else request.tool_choice
```

框架在存在 structured output 时会自己接管并强制 `"any"`。本项目绕过该机制手动设 `tool_choice`，
于是正面撞上"供应商不遵守具名 `tool_choice`"这个坑。

更重要的是：**LangChain 惯用法里"保证一次写入真的发生"从来不靠提示词或 `tool_choice`，而是靠让图成为权威。**
本项目 `hitl.py` 已经把这件事做对了——checkpoint 是唯一执行权威，工具在批准前物理上无法执行，
所以邮件/日历只需要 1 层防护。contacts / memos 的 5 层启发式，是因为没有采用同一个结构性思路。

## 四、middleware 职责混杂 + 顺序隐式耦合

`supervisor.py:277-284` 的组合顺序：

```python
middleware = [ScopedContextMiddleware(name)]     # 改 messages + 合并 system message
if hitl: middleware.append(hitl)                  # 拦截工具
if name == "contact_agent":
    middleware.append(RequireContactToolMiddleware())  # 又改 messages + 设 tool_choice
```

`ScopedContextMiddleware` 一个类做三件事（投影上下文、合并 system message、覆写 messages）；
`RequireContactToolMiddleware` 也覆写 messages，且**隐式依赖** ScopedContext 已经投影过——
顺序换一下行为就变。官方 middleware 的设计约定是单一职责 + 明确的组合语义。

## 五、按此分析修正后的建议优先级

对比正文第五节（那是"在现有架构内做清理"），本节是"架构层面的选择"。

> **勘误（2026-08-19，同日）**：本节初稿的第 1、2 条建议基于对两个官方 middleware 的错误理解，
> 已核实源码后作废，见上表。教训：内置 middleware 的名字听起来能覆盖需求，但必须读 `apply()` /
> `wrap_model_call()` 的实际实现才能确认——尤其"看起来能替代手写代码"的那些。

修正后的优先级：

1. **`Literal` 换掉 `record_contact_fact` 的 `dimension` / `category`，删掉静默强转。**
   schema 层强制，省数百字符 docstring，错值从静默污染变为可见错误。（正文问题 4）

2. **三对双胞胎参数化，顺带修掉 memos 侧的同一个 bug。**
   `memo_tool_choice` 目前仍返回具名 `"create_memo"`（`context.py:221`），
   而具名 `tool_choice` 已实测被供应商静默忽略——即 memos 的"强制保存"目前是失效的。（正文问题 2）

3. **把 4 个供应商 quirk 及其 workaround 集中标注**，每个注明实测现象与删除条件。
   由于 `ModelFallbackMiddleware` 不适用（见上表），这些 workaround 短期内无法移除，
   因此"能被将来的人安全理解和删除"就更重要。（正文问题 6）

4. **`ToolCallLimitMiddleware` 的适用性需先验证。**
   今天 trace 里的二次 handoff 由 supervisor 的 `post_model_hook`（`verify_agent_claims`）驱动，
   属于 supervisor 层循环；而该 middleware 是 per-agent 的 `create_agent` middleware，
   未必能挂到 `create_supervisor` 上。落地前需实测，不要照搬。

5. **中期评估从 Handoffs 迁到 Subagents。**
   这是唯一能从根上消掉 `context.py` 大部分存在理由的改动，也对应官方实测的 ~14K → ~9K token 差距。
   代价是 `create_supervisor` 那套要换成 agents-as-tools，`api/agent.py` 的 SSE 事件命名空间判断
   （`is_supervisor_stream_namespace`）与 HITL interrupt 的取用路径都需要重写——需单独立项。

6. **contacts / memos 的写入保证改走 `hitl.py` 的结构性思路**，停止叠加第 6 层启发式。

## 参考

- [Multi-agent — Docs by LangChain](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [Middleware — Docs by LangChain](https://docs.langchain.com/oss/python/langchain/middleware)
- [langgraph_supervisor — LangChain Reference](https://reference.langchain.com/python/langgraph-supervisor)
- [Deep Agents vs LangChain vs LangGraph — LangChain Blog](https://www.langchain.com/blog/deep-agents-vs-langchain-vs-langgraph)
- 内置 middleware 清单以本地 `.venv` 实装版本 `langchain 1.3.11` 的 `langchain.agents.middleware` 导出为准

---

## 附：清理过程中发现并修复的第四个 bug（已完成，非待办）

2026-08-19，执行本文档第五节建议 1、2 时，端到端验证发现了一个**独立于本次重构、HEAD 提交里就已存在**的问题（`git show HEAD` 确认）：

`verify_agent_claims` 的强制重试（`context.py` 的 `_verify_claims`）没有任何上限。当子 agent 持续不调用工具、只用文字重复"已完成"话术时（`tool_choice` 被忽略是已知供应商 quirk 之一），该 hook 会无限次强制重新 handoff——实测跑出几十次往返后，累积的消息最终被裁剪到只剩 system message，触发 `openai.BadRequestError 400 messages 参数非法`，整个请求崩溃。

修复（`context.py`）：
- `_MAX_VERIFY_RETRIES = 2`：`_verify_claims` 数达到上限后放弃强制重试，让（可能是假的）文字回复直接返回给用户，而不是无限循环或崩溃——"结束但可能不准确"好过"直接崩"。
- `RequireWriteToolMiddleware._request` 加了一道防御：如果 `_strip_foreign_tool_pairs` + `_drop_historical_ai_text` 处理完的消息列表里连一条 `HumanMessage` 都不剩，直接回退到原始未处理的消息，不发送空/无人类轮次的 payload。

验证：`tests/test_contact_routing.py` 新增 4 条单测（重试计数在上限内外的行为、strip 流程不会清空人类消息）；并用真实模型跑了一次有界回归（`recursion_limit=40`），memos 与 contacts 两条链路都在合理调用次数内完成，无崩溃、无死循环，事实正确落库。
