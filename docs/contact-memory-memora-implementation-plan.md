# Contact Memory 的 Memora 化工程实施计划

> 状态：Implementation Complete / Evaluation Pending
> 适用范围：Friday Contact Relationship Brain
> 目标：引入 Primary Abstraction、Memory Value、Cue Anchor 和可选的策略式检索，同时保留现有 Postgres + Qdrant 技术栈与 Contact UI。

## 实施进度

- 2026-09-17：开始 Phase 0。已建立统一的 `ContactMemoryService` 写入边界，并将长文本提取、单条聊天事实、手工 API 和 Memo 同步四个生产入口接入；本批次保持现有 `contact_profiles` 存储行为不变。
- 2026-09-17：完成 Phase 1 数据基础。新增 Primary Abstraction 字段、Evidence/Revision 审计表和 Alembic migration；所有新写入都会旁路记录影子数据，失败时不阻断现有 v1 写入。
- 2026-09-17：完成可重入历史 backfill 和 Primary Abstraction v2 索引基础。新增用户级批处理 API、`SKIP LOCKED` 续跑、`contact_memory_v2` 独立 collection、租户隔离检索及 `abstraction_indexed_at` 补偿队列。
- 2026-09-17：完成 Top-K candidate retrieval 与结构化 Merge Judge 影子链路。Judge 只读取同一 user/contact 的候选，非法 target 和低置信度均降级为 `create`，决策写入独立审计表与 v1 结果对比，不改变线上真值。
- 2026-09-17：建立第一版离线 Judge goldset 与评分脚本，覆盖重复、时间变化、冲突、相似但不同事件、数值口径和误召回主题，并单独统计 unsafe merge 与保守 false create。
- 2026-09-18：移除 Contact Memory 启用型环境变量。影子审计、v2 索引和 Merge Judge 改为默认常开；外部依赖失败继续采用 best-effort 降级与索引补偿，不影响 v1 事实写入。
- 2026-09-18：完成 Cue Anchor 数据与检索基础。新增共享 cue/link 表、cue Qdrant point、写入与补偿索引，以及 Primary + Cue 并行召回、链接展开、去重融合的独立 retrieval service；敏感值和 Primary 的机械重复不会写入 cue。
- 2026-09-18：将 Primary+Cue 检索接入 `search_contacts` 默认语义回退。v2 返回聚合 Memory Value，原 `contacts` collection 同步保留身份与互动召回，两路结果按联系人去重后加载完整档案。
- 2026-09-18：完成 Phase 2 权威写入切换。高置信度 Judge 的 `merge/noop/conflict` 在用户与联系人范围内事务执行；`noop` 只追加 Evidence，`merge` 更新聚合值并追加 Revision，`conflict` 保留两条 disputed 陈述。目标失效时安全退化为 create。
- 2026-09-18：补齐历史 Cue Anchor 独立回填。已完成 Primary 回填但没有 cue-link 的旧记忆也会生成不含 Memory Value 的稳定召回短语，并复用 cue 索引补偿队列。
- 2026-09-18：完成 Phase 4 的有界 Policy-guided Retriever。复杂查询默认进入最多两步的 `EXPAND/RE_QUERY/STOP` 循环，简单查询仍为单轮；策略只能选择已提供的 cue id，模型或扩展失败时稳定返回当前 working set。
- 2026-09-18：删除改为可恢复软删除，并新增人工纠错、恢复、Evidence/Revision 历史 API；人工纠错绕过自动 Judge，优先级高于自动提取。
- 2026-09-18：使用本地阿里云 Qwen `qwen3.6-flash` 完成首轮 Judge goldset 基线；8/8 action 与 target 正确，unsafe merge 和 false create 均为 0。评估脚本现会主动加载 `backend/.env`，与应用使用相同 provider profile。
- 下一批：扩充真实脱敏样例并运行 Primary+Cue 与 Policy 多跳基线，继续校准阈值、延迟和成本预算；代码与测试实现不依赖启用型环境变量。

## 1. 背景

Friday 当前将联系人事实保存为 `contact_profiles` 原子记录，并直接把联系人名称、`fact_key` 和 `fact_value` 拼接后写入 Qdrant。长文本提取会把该联系人已有事实放入 LLM 上下文，让模型决定 `new/update/delete/skip`；单条聊天事实、手工录入和 Memo 同步则直接新增事实。

这套实现已经具备事实分类、来源追踪、向量召回和部分合并能力，但存在以下问题：

1. 不同写入入口的去重行为不一致，单条事实和 Memo 会持续产生重复记录。
2. 长文本提取需要把全部已有事实交给 LLM，联系人事实增长后成本和误判率都会上升。
3. Qdrant 直接索引事实内容，存储内容与检索入口耦合。
4. 更新会覆盖当前 `fact_value`，缺少完整的版本历史和多来源证据。
5. `contact_tags` 是联系人级标签，不具备记忆条目级、多对多的 Cue Anchor 语义。
6. 当前检索是单轮 SQL 或向量召回，难以回答跨记忆、跨联系人和多跳问题。

本计划借鉴 Memora 的表示方法，但不直接引入其研究代码。Friday 继续使用 Postgres 作为事实源、Qdrant 作为派生索引，并保持现有 API 和 UI 可渐进迁移。

## 2. 目标与非目标

### 2.1 目标

- 为每条联系人记忆建立稳定的 Primary Abstraction。
- 保留完整、可演进的 Memory Value，不因索引粒度损失细节。
- 建立记忆级 Cue Anchor 多对多关系，支持多角度召回和后续多跳扩展。
- 将所有 Contact Memory 写入口收敛到同一个 create-or-update 服务。
- 使用“向量候选召回 + LLM 最终判定”完成去重、合并、冲突和新建决策。
- 保留每次观察、来源、合并决策和历史版本，支持纠错与审计。
- 在不影响现网的前提下通过双写、影子检索和离线评估逐步切换。
- 全链路保持 `user_id` 强隔离，敏感信息不进入不必要的检索入口。

### 2.2 非目标

- P0 不训练 GRPO 或其他专用检索策略模型。
- P0 不引入图数据库，也不建设预定义 ontology。
- P0 不重做 Contacts 页面；现有 `dimension/category/fact_key/fact_value` 继续可用。
- 不用自动合并替代用户纠错、删除和来源审计。
- 不在没有 Friday 自有评估集的情况下宣称达到 Memora 论文结果。

## 3. 核心设计原则

1. **Postgres 是事实源，Qdrant 是可重建索引。** 向量写入失败不得破坏记忆写入。
2. **相似度只用于生成候选，不直接决定合并。** 最终操作由结构化规则与 LLM Judge 共同决定。
3. **Primary Abstraction 表达稳定身份。** 它描述“这条记忆长期在讲什么”，而不是复述当前值。
4. **Value 保留事实细节。** 当前状态、历史变化、时间和限制条件均保存在 value/revision/evidence 中。
5. **Cue 属于记忆，不属于联系人。** 现有联系人标签继续用于展示和筛选，不能复用为 Cue Anchor 表。
6. **更新不等于覆盖历史。** 每次输入都保留 evidence；聚合值变化时生成 revision。
7. **宁可漏合并，不可误合并。** 低置信度时创建新记忆或标记冲突，不把信息不可逆地揉在一起。
8. **先证明写入质量，再增加检索自治。** Policy retriever 必须建立在可靠的数据表示和评估集之上。

## 4. 目标数据模型

### 4.1 现有表的职责

| 现有对象 | 迁移后的职责 |
|---|---|
| `contacts` | 联系人身份和结构化基础字段 |
| `contact_profiles` | 记忆主记录，即 Primary Abstraction + 当前聚合 Value |
| `contact_interactions` | Episodic Context，保存一段交流的摘要与原始片段 |
| `contact_tags` | 联系人级 UI 标签和筛选维度；不作为 Cue Anchor |
| Qdrant `contacts` collection | 迁移期间保留的 v1 索引 |

### 4.2 `contact_profiles` 增量字段

优先扩展现有表，避免第一阶段同时重做 API 和前端。

```sql
ALTER TABLE contact_profiles
    ADD COLUMN primary_abstraction TEXT,
    ADD COLUMN memory_status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN occurred_at TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN abstraction_indexed_at TIMESTAMPTZ;
```

字段约束：

- `primary_abstraction`：短、具体、稳定，必须包含联系人或明确领域及主题。
- `fact_value`：当前完整聚合值，继续兼容现有 UI。
- `memory_status`：`active | superseded | disputed | deleted`。
- `occurred_at`：事实发生时间；未知时为空，不用写入时间冒充发生时间。
- `version`：每次聚合值变化递增。

示例：

| Primary Abstraction | Memory Value |
|---|---|
| 张三的任职经历 | 2025 年任技术经理；2026 年 8 月晋升为技术总监，目前仍在 A 公司。 |
| 李四的饮食偏好 | 喜欢热普洱；不吃花生，原因是过敏。 |
| Project Orion 的预算变化 | 初始预算 80 万；2026-09 经批准调整为 100 万。 |

不合格的 abstraction：

- `职位`：缺少实体和上下文。
- `张三职位变更为技术总监`：绑定了易变化的当前值。
- 直接复制完整事实句：失去抽象索引意义。

### 4.3 新增 Evidence 表

每次写入都生成 evidence，即使最终操作是 `noop`，也保留“相同事实再次出现”的来源。

```sql
CREATE TABLE contact_memory_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    memory_id UUID NOT NULL REFERENCES contact_profiles(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    observed_value TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    interaction_id UUID REFERENCES contact_interactions(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ,
    confidence FLOAT NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

需要为 `(user_id, memory_id)`、`(user_id, source_type, source_id)` 和 `(contact_id, occurred_at)` 建索引。

### 4.4 新增 Revision 表

Revision 记录聚合状态变化和判定依据，支持审计、回滚与时间问题回答。

```sql
CREATE TABLE contact_memory_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    memory_id UUID NOT NULL REFERENCES contact_profiles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    operation TEXT NOT NULL,
    previous_abstraction TEXT,
    next_abstraction TEXT NOT NULL,
    previous_value TEXT,
    next_value TEXT NOT NULL,
    decision_reason TEXT,
    decision_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (memory_id, version)
);
```

`operation` 取值：`create | merge | correct | conflict | delete | restore`。

`decision_metadata` 可记录候选分数、Judge 模型、prompt version、置信度和候选 memory id，但不得记录 API key 或无必要的完整敏感输入。

### 4.5 新增 Cue 与关联表

```sql
CREATE TABLE contact_memory_cues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    cue_text TEXT NOT NULL,
    cue_normalized TEXT NOT NULL,
    indexed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, cue_normalized)
);

CREATE TABLE contact_memory_cue_links (
    user_id TEXT NOT NULL,
    memory_id UUID NOT NULL REFERENCES contact_profiles(id) ON DELETE CASCADE,
    cue_id UUID NOT NULL REFERENCES contact_memory_cues(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (memory_id, cue_id)
);
```

Cue 生成约束：

- 每条记忆生成 0–3 个 cue。
- 典型格式为“实体/领域 + 侧面”，如 `张三 晋升`、`张三 技术管理`。
- Cue 应补充 primary abstraction 未覆盖的召回角度，不能机械重复 abstraction。
- 不把身份证号、银行卡、完整住址、健康诊断细节等敏感值写入 cue。
- 共享 cue 通过关联表连接多条记忆；不在 Qdrant payload 中维护可变 memory id 数组。

## 5. Qdrant v2 索引设计

迁移期间新增 `contact_memory_v2` collection，不原地改变当前 `contacts` collection。

### 5.1 Point 类型

**Primary point**

- Point ID：`contact_profiles.id`
- Embedded text：`primary_abstraction`
- Payload：`user_id`、`contact_id`、`memory_id`、`index_kind=primary`、`dimension`、`category`、`status`

**Cue point**

- Point ID：`contact_memory_cues.id`
- Embedded text：`cue_text`
- Payload：`user_id`、`cue_id`、`index_kind=cue`
- 命中后从 Postgres 的 `contact_memory_cue_links` 加载关联记忆。

Memory Value、原始片段和历史 revision 不直接 embedding。需要回答时再根据 `memory_id` 从 Postgres 加载。

### 5.2 检索隔离

- 每个 dense、sparse、fallback 分支都必须使用 `user_id` filter。
- 联系人详情问答可附加 `contact_id` filter。
- 跨联系人查询只按 `user_id` 检索，由结果中的 `contact_id` 聚合。
- 应保留结果返回后的防御性 `user_id` 二次校验。

### 5.3 索引一致性

- 数据库事务先提交，随后 best-effort 写 Qdrant。
- 索引失败时相应 `indexed_at` 保持 `NULL`。
- 扩展现有 reindex compensation job，使其可重建 primary 和 cue。
- v2 全量重建不得影响 v1 collection。

## 6. 统一写入链路

新增领域服务，例如：

```python
upsert_contact_memory(
    *,
    user_id: str,
    contact_id: str,
    candidate: ContactMemoryCandidate,
    source: MemorySource,
) -> MemoryWriteResult
```

所有生产写入口必须调用该服务：

- `record_contact_fact`
- `extract_contact_memory`
- `POST /contacts/{contact_id}/facts`
- `sync_memo_to_contact`
- 后续邮件自动提取和其他后台 worker

Repository 的低层 `add_contact_profile()` 仅供领域服务、迁移和测试调用，不能继续作为业务入口。

### 6.1 Candidate 结构

```json
{
  "primary_abstraction": "张三的任职经历",
  "dimension": "business",
  "category": "event",
  "fact_key": "employment_history",
  "fact_value": "2026 年 8 月晋升为技术总监",
  "occurred_at": "2026-08-01T00:00:00+08:00",
  "cues": ["张三 晋升", "张三 技术管理"],
  "confidence": 0.92
}
```

提取输出必须使用 Pydantic/JSON Schema 验证，拒绝未知 action、无 value、跨联系人 id 和非法时间格式。

### 6.2 Create-or-update 流程

```text
输入文本
  ↓
提取结构化 candidate
  ↓
在同一 user/contact 范围内，用 abstraction 检索 Top-K 候选
  ↓
按宽松阈值过滤候选；无候选则直接 create
  ↓
LLM Judge 读取 candidate 与少量候选的 abstraction/value/recent evidence
  ↓
create | merge | noop | conflict
  ↓
Postgres 事务：memory + evidence + revision + cue links
  ↓
事务提交后写 Qdrant；失败进入 compensation backlog
```

### 6.3 Judge 输出

```json
{
  "action": "create|merge|noop|conflict",
  "target_memory_id": "uuid-or-empty",
  "merged_abstraction": "stable abstraction",
  "merged_value": "complete updated value",
  "reason": "brief decision reason",
  "confidence": 0.0
}
```

硬性校验：

- `merge/noop/conflict` 的目标必须来自本次候选集合。
- 目标必须属于相同 `user_id` 和 `contact_id`。
- 低于配置置信度不得自动 merge；默认退化为 create 或 conflict。
- Primary similarity score 只决定是否进入 Judge，不得单独触发 merge。
- `noop` 仍新增 evidence，但不增加 revision/version。
- `merge` 必须新增 evidence 和 revision，再更新当前聚合值。
- `conflict` 不静默覆盖，保留两个陈述并将状态标记为 `disputed`，或按领域规则产生时间化更新。

### 6.4 分类合并策略

| 类型 | 默认策略 |
|---|---|
| 稳定身份信息 | 相同概念合并；矛盾时进入 conflict，不直接覆盖 |
| 偏好/习惯 | 允许随时间变化；聚合值保留“过去/目前”语义 |
| 职位、公司、地点 | 作为时间化状态更新，保留任职/迁移历史 |
| dynamic 事件 | 只有同一事件的补充信息才合并；相似主题但不同日期通常新建 |
| 数值/预算/规模 | 保留数值、币种、适用范围和发生时间；不同口径不得合并 |
| private 信息 | 合并逻辑相同，但 abstraction/cue 应去除不必要的敏感值 |

## 7. 检索链路

### 7.1 Semantic Retriever（首个上线版本）

```text
用户 query
  ├─ primary dense/sparse 检索
  └─ cue dense/sparse 检索
          ↓
      RRF/加权融合
          ↓
  cue_id → Postgres link → memory_id
          ↓
按 memory_id 去重、重排、加载 value/evidence
          ↓
按联系人与 episodic context 组织 Agent 上下文
```

不要设计成“Primary 没命中才查询 Cue”。两个索引应联合提供初始候选。

排序建议同时考虑：

- primary/cue 检索分数；
- dense 与 sparse 命中一致性；
- 当前状态和争议状态；
- `occurred_at` 新近程度，但不能让时间衰减压过明确语义匹配；
- 同一记忆被多个入口命中的加分；
- 对问题类型的适配，例如“以前/变化/最初”查询需要历史 evidence。

### 7.2 Policy-guided Retriever（后续可选）

状态包含：原始问题、当前 query、working set、frontier、剩余步数和 token/延迟预算。

允许动作：

- `EXPAND`：沿 working set 的共享 cue 找关联记忆。
- `RE_QUERY`：根据当前缺口生成新的短查询，重新检索 primary + cue。
- `STOP`：已有信息足够或预算耗尽。

上线约束：

- 默认最多 2 次策略动作，硬上限可配置。
- 必须有总 token、LLM 调用次数和墙钟时间预算。
- Policy 失败或输出非法 JSON 时立即返回当前 working set。
- 简单单跳查询默认走 semantic retriever，不承担额外多轮延迟。
- 仅当离线集证明多跳收益覆盖成本时启用。

## 8. 分阶段实施

### Phase 0：评估基线与接口收敛

工作项：

- 建立 Contact Memory 离线评估集，覆盖重复、更新、冲突、时间变化、跨事实和跨联系人问题。
- 记录当前系统的事实数、重复率、检索命中率、写入延迟、检索延迟和 LLM 成本。
- 定义 `ContactMemoryCandidate`、`MemoryWriteResult` 和 Judge schema。
- 将四个现有写入口收敛到领域服务，但保持旧存储行为，先完成接口统一。
- 给 prompt、Judge 和索引 schema 增加显式版本号。

退出条件：

- 所有生产写入口均通过统一服务。
- 旧行为测试全部通过。
- 有可重复运行的离线基线报告。

### Phase 1：Primary Abstraction + 可靠合并基础

工作项：

- 新增 profile 字段、evidence 和 revision 表。
- 为新写入生成 primary abstraction。
- 实现 Top-K candidate retrieval 和结构化 LLM Judge。
- 先记录新旧决策差异，再由 Phase 2 切换为权威事务。
- 记录新旧决策差异，不把 shadow 数据展示给用户。
- 为旧数据运行可重入 backfill，生成 abstraction 和初始 revision/evidence。

退出条件：

- 误合并率达到验收阈值，且不存在跨用户、跨联系人合并。
- Judge 决策覆盖所有自动写入口。
- Backfill 可暂停、续跑、重复执行，不产生重复 revision/evidence。

### Phase 2：Primary 写入切换

工作项：

- 在离线验收达标后，将新领域服务设为 Contact Memory 真值写入路径。
- `noop`、`merge`、`conflict` 和 `create` 均生成完整审计记录。
- UI 继续读取当前 `contact_profiles.fact_value`，无需同步重做。
- 增加用户纠错后的 revision，并确保纠错优先级高于自动提取。
- 自动 merge 失败时必须退化为 create/conflict，并保留完整审计记录。

退出条件：

- 重复增长率明显低于基线。
- 用户纠错、删除、恢复和来源展示没有回归。
- 写入 P95、错误率和成本处于预算内。

### Phase 3：Cue Anchor + 双索引检索

工作项：

- 新增 cue/link 表和 `contact_memory_v2` collection。
- 对新写入双写 v1/v2；对历史数据 backfill cue。
- 运行 v1 与 v2 影子检索，比较相关性和漏召回。
- 新建独立 retrieval service，支持 primary + cue 联合搜索。
- 按 user/contact scope 加载 value、revision 和 episodic context。
- 分批将 `search_contacts` 和未来 `get_contact_memory` 切换到 v2。

退出条件：

- v2 Recall@K 和答案正确率不低于 v1，并在跨侧面问题上有明确提升。
- 所有查询路径通过租户隔离测试。
- v2 可从 Postgres 完整重建。

### Phase 4：Policy-guided Retrieval 实验

工作项：

- 构建 working set/frontier 和共享 cue 扩展查询。
- 实现 `EXPAND/RE_QUERY/STOP` 的 prompt policy。
- 对复杂问题启用 query classifier，简单问题仍走单轮检索。
- 评估答案质量、额外 token、LLM 调用数、P50/P95 延迟和无效扩展率。
- 默认对复杂查询启用，严格限制步数和 working-set 大小；暂不训练 GRPO。

退出条件：

- 多跳/跨记忆测试集正确率有统计上稳定的提升。
- 延迟和成本不超过产品预算。
- 达到预算或策略异常时能够稳定降级到 semantic retriever。

## 9. 数据迁移、灰度与回滚

### 9.1 Backfill

- 按 `user_id` 和主键分页，不使用无界全表扫描。
- 每批为旧事实生成 abstraction、初始 revision、evidence 和 cue。
- 保存 backfill version，允许 prompt 更新后重新生成派生字段。
- 无可靠来源的旧记录使用 `source_type=unknown`，不伪造来源。
- Backfill 不自动合并历史行；先生成 merge proposal，离线审核后再单独执行。

### 9.2 常开与失败隔离

- 统一写入、Primary Abstraction/Evidence/Revision、v2 索引、Merge Judge 和复杂查询 Policy 默认常开，不使用启用型环境变量控制。
- Postgres `contact_profiles` 是当前值投影与事实真值；Qdrant 仍是可重建派生索引，索引失败不能回滚 Postgres 事务。
- Qdrant 写入失败时保留 `abstraction_indexed_at IS NULL`，由 backfill/compensation API 重试。
- Judge 检索失败时不伪造 `create` 决策，本次退回原有明确写入动作。
- Policy 失败、输出非法 action/cue 或达到预算时立即停止，并返回当前 semantic working set。

### 9.3 回滚

- 当前 v1/v2 collection 独立且并行召回，代码回滚不需要重建旧索引。
- Revision 使未来错误 merge 可恢复到指定版本；不得通过删除 audit row 回滚。
- Schema migration 保持只增加列和表，不通过 downgrade 删除 Evidence/Revision 审计数据。

## 10. 测试与评估

### 10.1 写入测试集

至少覆盖：

- 完全重复事实 → `noop`，新增 evidence，不新增 memory。
- 同一概念的补充细节 → `merge`。
- 当前状态变化 → `merge/correct`，保留历史。
- 相似措辞但不同事件 → `create`。
- 同一联系人相似主题但不同家庭成员 → 不误合并。
- 同名联系人 → 不跨 `contact_id` 合并。
- 不同用户相同事实 → 绝不互相召回或合并。
- Memo、聊天、长文本、手工 API 写入得到一致决策。
- 并发写入同一概念 → 不产生重复 memory 或 version。
- Qdrant 不可用 → Postgres 成功、索引待补偿。
- LLM 超时或非法 JSON → 安全降级，不做不可逆 merge。

### 10.2 检索测试集

- 直接状态问题：“张三现在是什么职位？”
- 历史问题：“张三之前做什么？”
- 变化问题：“他的职位怎么变化的？”
- 侧面问题：“喜欢喝茶的投资人是谁？”
- 跨联系人问题：“最近换工作的人有哪些？”
- 多跳问题：“提过预算调整、而且下个月要见面的人是谁？”
- 否定与纠错：“谁已经不在 A 公司？”
- 来源问题：“这条信息从哪里知道的？”

### 10.3 核心指标

| 类别 | 指标 |
|---|---|
| 写入质量 | false merge rate、missed merge rate、duplicate growth rate、conflict accuracy |
| 检索质量 | Recall@K、MRR/nDCG、answer correctness、temporal correctness、source attribution accuracy |
| 效率 | 每次写入 LLM 调用数/token、检索 P50/P95、策略平均步数、Qdrant 查询数 |
| 稳定性 | extraction/Judge parse failure、index backlog、reindex success rate、降级率 |
| 安全 | cross-tenant leakage=0、跨联系人误合并率、敏感 cue 泄露率 |

正式启用自动 merge 前，必须由产品确定可接受阈值。原则上 false merge 的容忍度应显著低于 missed merge。

## 11. 可观测性

建议为每次写入生成 `memory_operation_id`，记录：

- 输入来源类型，不记录无必要的完整敏感原文；
- 候选数量和相似度分布；
- Judge action、confidence、target id、prompt/model version；
- DB 写入结果、version 和 evidence id；
- v1/v2 索引状态与重试次数；
- 总延迟、embedding 延迟、Judge 延迟和 token 使用量。

建议 Dashboard/告警：

- Qdrant 待索引记录持续增长；
- 自动 merge 比例突增或突降；
- `conflict` 比例异常；
- Judge parse failure 超阈值；
- P95 写入或检索延迟超预算；
- 租户隔离断言失败时立即停止 v2 检索。

## 12. 安全与隐私

- 所有新表查询必须显式包含 `user_id`；不能仅依赖 `memory_id` 的不可猜测性。
- Qdrant 的每个检索分支都需要 `user_id` filter，并在返回后再次检查 payload。
- Cue 和 abstraction 属于高频检索面，内容应比 value 更少、更抽象。
- Private/健康/财务类事实默认禁止把具体数值和诊断写入 cue。
- 日志只记录 id、action、分数和版本；原始文本应使用受控 tracing 开关并做脱敏。
- 用户删除联系人或记忆时，Postgres 子表和 v1/v2 Qdrant points 都必须清理。

## 13. 预计代码影响范围

| 区域 | 主要改动 |
|---|---|
| `backend/alembic/versions/` | 新表、字段、索引和约束迁移 |
| `backend/app/services/contact_brain_service.py` | 提取 candidate，移除“把全部已有事实塞进一个 prompt”的长期依赖 |
| `backend/app/services/` | 新增统一 memory write/retrieval service 与 Judge |
| `backend/app/infrastructure/db/repositories/contacts.py` | memory/evidence/revision/cue 的事务操作和 backfill/reindex |
| `backend/app/infrastructure/vector/qdrant.py` | v2 collection、primary/cue points、联合检索和重建 |
| `backend/app/agents/tools.py` | 所有 Contact/Memo 写入口接入统一服务，后续切换到统一检索服务 |
| `backend/app/api/contact.py` | 手工事实写入、纠错、删除/恢复、revision 回滚和 history/source API |
| `backend/tests/` | 写入判定、并发、隔离、迁移、降级和离线评估测试 |
| `frontend/src/pages/ContactsPage.jsx` | 后续可选：历史、冲突和来源展示，不阻塞后端 P0 |

## 14. 开发前需要确认的产品决策

1. UI 默认展示“当前聚合值”还是“当前值 + 历史时间线”。
2. `conflict` 是否需要用户确认入口，还是只在回答中注明信息存在冲突。
3. 自动 merge 的目标 false merge 上限。
4. Private 类型是否允许跨联系人聚合查询。
5. 用户手工编辑与自动提取冲突时，是否始终以手工编辑为最高优先级。
6. Policy retrieval 可接受的 P95 延迟和单次查询成本。

当前实现采用保守阈值、严格租户范围和有界检索预算默认开启；上述产品决策用于后续校准体验和成本，而不再作为代码启用开关。

## 15. Definition of Done

整个项目完成需同时满足：

- 所有 Contact Memory 写入口使用统一 create-or-update 服务。
- 每条活跃记忆都有合法 Primary Abstraction、当前 Value、来源 evidence 和可审计 revision。
- Cue 是记忆级多对多结构，且与联系人标签职责分离。
- 线上检索同时利用 primary 和 cue，并能加载完整 value 与 episodic context。
- 错误 merge 可以通过 revision 恢复，不需要手工修改数据库。
- v2 索引可以从 Postgres 全量重建，并能随时回退到 v1。
- 离线评估证明重复率下降、检索质量提升，且延迟和成本符合产品预算。
- 跨用户信息泄漏测试为零失败。
- Policy retriever 即使不启用，也不影响表示层和基础检索的完整性。
