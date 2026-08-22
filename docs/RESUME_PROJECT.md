# 简历项目经历维护

最后更新：2026-08-18 15:34（Asia/Singapore，UTC+08:00）

## 项目经历

### Friday｜自托管多 Agent 个人 AI 工作台

技术栈：FastAPI、LangGraph、LangChain、PostgreSQL、Qdrant、FastEmbed、React、Supabase、Microsoft Graph

1. 主导搭建邮件、日历、备忘录、GitHub 四域 Agent 系统，采用“规则优先、LLM Supervisor 兜底”路由；显式意图单次减少 1 次 Supervisor 调用，预计降低约 20%～30% 路由耗时与 Token 开销。

2. 设计领域级上下文隔离，将 Supervisor/子 Agent 输入限制在 20k/10k Token，并仅注入最近 4 轮同域历史；按 10 轮以上长会话估算，减少约 50%～70% 的无关上下文输入。

3. 构建 Qdrant Dense+BM25 双路召回与 RRF 融合链路，结合按需查询改写、5 秒稀疏计算超时和 Dense/PostgreSQL 多级降级，面向千级个人知识数据提供秒级检索能力。

4. 为邮件、日历 7 类高风险写操作接入 LangChain HITL，在工具执行前持久化中断、审批后恢复执行，并通过会话级异步锁避免并发 Checkpoint 覆盖和重复工具调用。

5. 设计联系人关系大脑及可溯源增量索引，建立中英混合检索 Goldset 和 Recall@K/MRR 评测链路；累计通过 157 项后端检查、32 项 RAG 单测及 35 项前端测试。

6. 围绕中文混合检索开展技术选型，识别 FastEmbed BM25 的中文分词限制及 Qdrant Sparse IDF 配置问题，对比 Qdrant+中文分词、Milvus 内置 BM25 与 OpenSearch Hybrid Search，基于召回效果、迁移成本和自托管复杂度制定演进路线。

> 口径说明：第 1～3 条中的比例、数据规模和响应速度为个人项目规模下的保守工程估算；在获得正式压测或离线评测结果后，应替换为实测数据。

## 技术选型与架构讨论记录

### 2026-08-18 15:34｜中文 Sparse/BM25 检索方案选型

- **问题背景**：当前 Dense 与 Sparse 两路召回相互独立；Sparse 侧使用 FastEmbed `Qdrant/bm25`，其默认分词与词干处理偏向英文，无法直接解决中文无空格分词问题。
- **澄清结论**：Qdrant Core 可以存储和检索任意 Sparse Vector，但本地 SDK 暴露 `Document`/`Bm25Config` 类型不代表当前自托管实例提供 Native Multilingual BM25；当前部署仍需在应用侧生成中文 Sparse Vector。
- **候选方案**：
  1. 保留 Qdrant 与现有 Dense Embedding，在应用层增加 Jieba、字符 N-gram、统一归一化与 IDF 配置，并全量重建 Sparse 索引。
  2. 迁移 Milvus，使用内置 BM25、Jieba Analyzer 与 Dense+Sparse Hybrid/RRF。
  3. 迁移 OpenSearch，使用成熟中文倒排索引、结构化过滤与 Hybrid Search Pipeline。
- **阶段性决策**：暂不因分词问题直接替换向量数据库；优先验证应用侧中文分词方案，并以 Recall@1、Recall@5、MRR、错人 Top-1 率和 P95 延迟做消融评测。若效果或维护成本不达标，再优先评估 Milvus。
- **边界**：本次仅完成技术调研与架构决策记录，尚未修改检索实现，不能在简历中表述为“已完成迁移”或“已提升召回率”。

