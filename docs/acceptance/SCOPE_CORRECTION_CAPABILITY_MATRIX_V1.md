# P0 范围纠偏能力验收矩阵 V1

基线：`bb945b038a2694856e11f3cfa08bfa931118ae87`

本矩阵只判断“国内 GEO 运营与交付系统”主系统。国内 AI 检测代码统一归类为
`INDEPENDENT_DETECTION_SYSTEM_PROTOTYPE`，其结构化 Observation 缺失为
`DEFERRED_TO_INDEPENDENT_DETECTION_SYSTEM`，不属于主系统 P0 阻断。

## 冻结边界

- 企业知识库是核心基础；关键词数据是可选增强输入。
- 无关键词、人工关键词、任意真实来源关键词数据集三种模式均必须合法。
- 百度关键词仅作为 `BaiduKeywordAdapter` 保留，不能定义 Keyword Core。
- 普通关键词记录与 `DemandEvidence` 分离；缺失的需求字段不得显示为零。
- Probe 不得阻断内容生产、内容审核、人工交付、项目完成或客户报告。
- Provider、自动批准、自动发布、自动登录继续关闭。

## P0 验收项

| 能力 | API 接线 | 用户可用 | 必须证据 | 当前状态 |
|---|---:|---:|---|---|
| 企业知识库可用 | 是 | 是 | 持久化、刷新、权限 | VERIFIED_BASELINE |
| 无关键词路径可运行 | 是 | 是 | KnowledgePackage → 问题候选 → Opportunity | VERIFIED |
| 人工关键词可用 | 是 | 是 | 添加、读取、审核、刷新 | VERIFIED |
| 通用文件关键词可用 | 是 | 是 | CSV/XLSX、字段映射、批次、审核 | VERIFIED |
| 百度关键词 Adapter 可用 | 是 | 是 | 兼容读取及原审核链 | CURRENT_BASELINE |
| AI 拓词可用 | 是 | 是 | 无关键词与可选关键词两条路径 | VERIFIED |
| 用户问题确认可用 | 是 | 是 | 人工决定、刷新、权限 | CURRENT_BASELINE |
| Opportunity 可创建 | 是 | 是 | 知识驱动候选可进入既有业务关系 | VERIFIED |
| 内容生产可进入 | 是 | 是 | 不依赖百度或 Probe | VERIFIED |
| 轻门禁可运行 | 是 | 是 | 规则评估与人工修复 | VERIFIED_BASELINE |
| 内容审核可运行 | 是 | 是 | 人工审核、无自动批准 | VERIFIED_BASELINE |
| 人工交付可持久化 | 是 | 是 | 回执写入、刷新重读 | CURRENT_BASELINE |
| 代理商授权与隔离 | 是 | 是 | 未授权 403 | CURRENT_BASELINE |
| 三角色工作台真实 | 是 | 是 | 首页与导航符合新边界 | VERIFIED |
| Probe 不阻断主链 | 是 | 是 | 无 Probe 数据仍可完成交付 | VERIFIED |
| 版本与 Bundle 真实性 | 是 | 是 | Branch/HEAD/Bundle SHA 一致 | CURRENT_BASELINE |

## 明确排除

- `STRUCTURED_AI_OBSERVATION_REQUIRED` 已从主系统 P0 删除。
- 品牌提及、推荐、答案位置、引用判断、检测趋势和完整检测报告由独立检测系统承担。
- 本波次不启用真实百度 API、Probe Provider、自动登录、自动批准或自动发布。

## 纠偏证据

- Migration `0018_generic_keyword_core.sql`：通用数据集、记录、来源、导入批次、审核与独立需求证据。
- 通用来源：`MANUAL`、`GENERIC_FILE`、`BAIDU_KEYWORD`、`CUSTOMER_HISTORY`、`OTHER_PROVIDER`。
- 百度旧表通过只读兼容 Adapter 接入；历史 Migration `0011` 未修改。
- 知识优先预览和人工确认由服务端读取 KnowledgePackage；无关键词时仍可创建候选。
- 可选关键词增强由服务端按租户读取；客户端提交的伪造 Seed/Evidence 被忽略。
- 人工普通词只作为 Seed，不产生 DemandEvidence；真实指标必须来自独立持久化证据。
- `BAIDU_KEYWORDS` 与 `CHINA_AI_PROBE` 均只保留为历史事件值，已移出主系统必经顺序。
- Probe 原型、API、页面和 Migration `0013` 完整保留，并受默认关闭的原型开关与原权限保护。
- 聚焦回归证明零关键词、零 Probe 数据均不阻断内容、报告与人工交付。

## 本波次结束判定

- 通用 Keyword Core 或无关键词路径未完成：`BLOCKED_BY_KEYWORD_CORE_CORRECTION`
- Probe 仍阻断主系统：`BLOCKED_BY_PROBE_DECOUPLING`
- 两项边界均纠正并完成本矩阵证据：`SCOPE_CORRECTION_READY_FOR_NEW_GATE`
