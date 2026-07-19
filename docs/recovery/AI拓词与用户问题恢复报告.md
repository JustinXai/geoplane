# AI 拓词与用户问题恢复报告

## 1. 调查边界

- 基线：`baf550d3fc17589de2b474706560107763176cf1`
- 分支：`local/ai-expansion-facts-v1`
- 当前仓库：只读核对 `KnowledgePackage`、`IndustryProfile`、`KeywordQuestionMap`、`Opportunity`、`OpportunityValidation`、`HumanReviewDecision`、Provider 边界、迁移、路由与测试
- 上游设计：只读核对 Agent B 尚未实现的百度关键词目标 Contract 草案
- 恢复源：`E:\GEO_RECOVERY_SAFE` 只读；未写入、复制或改动恢复源
- 本轮只写事实与 Contract/状态机冻结文档，不写迁移、API、Adapter 或业务代码

严格使用六类标签：

| 标签 | 含义 |
|---|---|
| `RECOVERED_IMPLEMENTED` | 恢复证据证明原系统存在可执行实现 |
| `RECOVERED_SPECIFIED_NOT_COMPLETED` | 恢复源证明删除前存在明确方向，或本阶段指令对 AI 拓词明确强制使用该默认分类；均不代表已有实现 |
| `REBUILT_EQUIVALENT` | 当前重建系统已提供等价业务能力，但不是原代码恢复 |
| `CURRENT_REBUILD_ADDITION` | 当前重建阶段新增、且无恢复实现证据的能力 |
| `MISSING_REQUIRED_CAPABILITY` | 当前 AI 拓词与用户问题闭环必须具备、但尚不存在的能力 |
| `DEFERRED_BY_FROZEN_SCOPE` | 冻结范围明确推迟或禁止的能力 |

## 2. 结论

当前系统已经实现“人工提交关键词与用户问题 → 创建内容机会 → 自动规则校验 → 人工审核”的真实数据库链路，但没有 AI 拓词或 AI 用户问题生成能力。

关键结论：

1. `KeywordQuestionMap.entries` 完全来自请求体，当前代码不会生成关键词或用户问题。
2. 当前 Provider Port 只允许生成文章标题、摘要和正文段落，结构上禁止输出治理状态；它不能冒充拓词 Contract。
3. 当前关键词表没有 `generation_run_id`、`model_adapter_version`、`prompt_version`、来源快照、置信度、理由、候选状态和 AI 标记。
4. 当前机会命令会直接创建 Opportunity 并写入 `VALIDATED` 规则校验；AI 输出不得直接调用该路径绕过候选人工审核。
5. 三类 AI 标记严格限定为 `AI_EXPANDED_KEYWORD`、`INDUSTRY_HYPOTHESIS`、`KNOWLEDGE_GROUNDED_OPPORTUNITY`，所有 AI 候选默认 `NEEDS_HUMAN_REVIEW`。
6. AI 不能生成、估计或暗示搜索量、需求指数、热度、趋势、竞争度、点击价格、预计流量或排名等需求指标。

## 3. 恢复证据

### 3.1 AI 拓词实现证据

本轮没有找到可分类为 `RECOVERED_IMPLEMENTED` 的 AI 拓词或用户问题生成代码、迁移、测试或运行工件。

恢复材料只确认：

| 事实 | 分类 | 证据 |
|---|---|---|
| 灾后所有者重述目标包含“关键词与用户问题映射” | `RECOVERED_SPECIFIED_NOT_COMPLETED` | 本阶段指令明确要求 AI 拓词默认使用此分类；架构文档本身仍不是恢复工件 |
| `HUMAN_REVIEW_REQUIRED` 在恢复测试断言中有相近状态命中 | `RECOVERED_SPECIFIED_NOT_COMPLETED` | `docs/rebuild/recovered-evidence/TARGET_STATE_MANIFEST.md` |
| `NEEDS_HUMAN_REVIEW`、`INDUSTRY_HYPOTHESIS`、`KNOWLEDGE_GROUNDED_OPPORTUNITY` 逐字恢复检索为 0 命中 | `RECOVERED_SPECIFIED_NOT_COMPLETED` | 本阶段指令的强制默认分类；0 命中事实同时保留，不据此声称实现 |
| 相邻文章生产链存在真实 Provider 辅助与人工审批证据，但不是拓词 Contract | `RECOVERED_IMPLEMENTED` | `docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md` |

因此，本阶段可以恢复“必须人工审核、必须知识 grounding”的产品意图，不能声称恢复了原 AI 拓词输入/输出结构、Prompt 或模型调用实现。

### 3.2 Agent B 目标 Contract

Agent B 已冻结但尚未实现以下精确名称：

| Contract | 当前分类 | 与本阶段关系 |
|---|---|---|
| `KeywordReferenceSourceImport` | `MISSING_REQUIRED_CAPABILITY` | 权威关键词参考源导入批次 |
| `KeywordRawObservation` | `MISSING_REQUIRED_CAPABILITY` | 原始关键词观察，AI 不得改写 |
| `KeywordNormalizedForm` | `MISSING_REQUIRED_CAPABILITY` | 规范词版本，作为拓词去重/对齐依据 |
| `KeywordDiscovery` | `MISSING_REQUIRED_CAPABILITY` | 记录候选进入项目池的来源与方法 |
| `KeywordDemandObservation` | `MISSING_REQUIRED_CAPABILITY` | 真实需求指标观察；只能来自权威源，不得由 AI 生成 |
| `KeywordReferenceSnapshot` | `MISSING_REQUIRED_CAPABILITY` | AI 输入应固定的权威参考资产版本 |
| `KeywordTaxonomyVersion` | `MISSING_REQUIRED_CAPABILITY` | 分类体系版本 |
| `KeywordClassificationVersion` | `MISSING_REQUIRED_CAPABILITY` | 候选分类依据和版本 |
| `KeywordFamilyDraft` | `MISSING_REQUIRED_CAPABILITY` | 人工审核前的关键词族草稿 |
| `HumanReviewPackage` | `MISSING_REQUIRED_CAPABILITY` | 一批候选的人工审核包 |

证据：Agent B 草案 `E:\GEO_REBUILD_WORKSPACE\worktrees\domestic-keyword\docs\recovery\百度关键词运行时恢复设计.md`。上述十项在恢复源与当前代码中均没有实现，不能用 `KeywordQuestionMap` 等相近结构冒充。

## 4. 当前实现事实

| 能力 | 分类 | 当前事实 | AI 拓词差距 |
|---|---|---|---|
| `KnowledgePackage` | `CURRENT_REBUILD_ADDITION` | 当前有重建领域 Contract，并桥接真实 `knowledge_package`；固定 id + version | 没有面向生成的不可变输入快照清单与快照 hash |
| `IndustryProfile` | `CURRENT_REBUILD_ADDITION` | 项目级行业、校验层级、规则版本持久化 | 没有 AI 输入快照，也没有 Prompt 可见字段白名单 |
| `KeywordQuestionMap` | `CURRENT_REBUILD_ADDITION` | 关键词及至少一个问题，固定知识包版本和行业画像；Postgres 原子写入 | entries 由请求方直接提供；无生成归属、AI 标记、置信度、理由、候选审核状态 |
| `Opportunity` | `CURRENT_REBUILD_ADDITION` | 只能从 map 中已有关键词创建，固定知识包 id + 版本 | 不是 AI 候选容器，不应接收未审核拓词结果 |
| `OpportunityValidation` | `CURRENT_REBUILD_ADDITION` | `PENDING_VALIDATION/VALIDATED/REJECTED`，append-only；规则校验不是批准 | 当前命令直接写 `VALIDATED`，不等于 AI 候选经人工确认 |
| `HumanReviewDecision` | `CURRENT_REBUILD_ADDITION` | `APPROVED/CHANGES_REQUESTED/REJECTED`，真实 reviewer + 时间必填，append-only | 可复用审核原则，不能直接表达生成批次内逐词/逐问题审核 |
| 客户评审命令 | `CURRENT_REBUILD_ADDITION` | 客户决定 `CONFIRMED/CHANGES_REQUESTED/DEFERRED`，服务端绑定 reviewer | 可作为新 HumanReviewPackage 的交互语义参考 |
| Provider Port | `CURRENT_REBUILD_ADDITION` | 只生成文章内容；Default OFF；真实调用有安全开关与 ledger | 没有拓词专用 Port/Adapter/Contract；不得扩大现有文章输出 Contract |
| AI 拓词生成运行 | `MISSING_REQUIRED_CAPABILITY` | 不存在 | 缺运行身份、幂等、模型/Prompt 版本、输入 hash、状态与失败分类 |
| AI 用户问题输出 | `MISSING_REQUIRED_CAPABILITY` | 不存在 | 缺 UserQuestion/SearchExpression 对象与人工逐项审核 |

主要证据：

- `src/contracts/geo-business/entities.ts`
- `src/runtime/geo/services/keyword-question-service.ts`
- `src/runtime/geo/services/opportunity-service.ts`
- `src/runtime/geo/services/validation-service.ts`
- `src/runtime/geo/services/human-review-service.ts`
- `migrations/0003_geo_runtime.sql`
- `src/app/api/commands/projects/[projectId]/keyword-maps/route.ts`
- `src/app/api/commands/projects/[projectId]/opportunities/route.ts`
- `src/app/api/opportunities/[id]/reviews/route.ts`
- `src/runtime/provider/provider-port.ts`

## 5. 三类 AI 标记

三类标记按本阶段指令归入 `RECOVERED_SPECIFIED_NOT_COMPLETED` 的目标语义；精确字段草案本身是 `CURRENT_REBUILD_ADDITION`，对应生产能力仍缺失，不代表已实现，也不是需求事实：

| 标记 | 冻结含义 | 禁止解释 |
|---|---|---|
| `AI_EXPANDED_KEYWORD` | 模型根据已冻结输入提出的扩展关键词候选 | 不代表有搜索量、真实需求或可直接生产内容 |
| `INDUSTRY_HYPOTHESIS` | 模型提出“该词/问题可能与当前行业相关”的假设 | 不得展示为已证实行业事实 |
| `KNOWLEDGE_GROUNDED_OPPORTUNITY` | 候选明确引用一个或多个知识/参考快照 | 不等于当前已审核 `Opportunity`，也不等于 `CONFIRMED_DEMAND` |

`UserQuestion`、`SearchExpression` 是输出对象，不是第四、第五类 AI 标记。禁止新增同义枚举绕开这三类限制。

## 6. 需求指标禁止项

AI 输出 Contract 不允许出现或从文本暗示以下字段/概念：

- 搜索量、月均搜索量、需求指数、搜索指数
- 热度、趋势增幅、竞争度、难度
- CPC/点击价格、预计流量、点击率、排名概率
- 市场份额、平台覆盖率或任何未经真实观察支持的规模数字

`confidence` 仅表示模型对“候选是否符合当前知识与行业上下文”的自评，不能表示需求强度，不能驱动排序后的自动批准。真实需求值未来只能来自 Agent B 的 `KeywordDemandObservation`，并必须携带来源快照、口径、时间、地域和设备范围。

## 7. 可复用边界

1. 复用现有租户/项目授权、会话派生 actor、命令幂等、审计与 append-only 决定模式。
2. 复用 Provider Default OFF、错误分类、非秘密 ledger 和 Adapter 身份思路，但新增独立拓词 Port；不修改文章生成 Contract。
3. 复用 KnowledgePackage id + version 和 IndustryProfile ruleSetVersion 作为快照来源，但生成前必须由服务端解析并封存输入清单。
4. 只有 HumanReviewPackage 中明确确认的候选才能投影为 `KeywordQuestionMap`；只有进入 map 的词才能复用现有 Opportunity 后续链。
5. 未审核候选不得写入当前 `opportunity`、`keyword_question_map` 或正式客户页面指标。

## 8. P0 缺口与顺序

1. 冻结并实现 `AIKeywordExpansionRequestV1` / `AIKeywordExpansionResultV1` 与运行事件；详见配套 Contract 文档。
2. 先完成 Agent B `KeywordReferenceSnapshot` 与 `HumanReviewPackage` 最小能力，否则 AI 输出没有权威来源与审核落点。
3. 新增生成结果持久化，保存 `generation_run_id`、`model_adapter_version`、`prompt_version`、来源快照、`confidence`、`reason`、`status` 和 AI 标记。
4. 新增逐词、逐 UserQuestion/SearchExpression 的人工决定，默认状态必须由数据库约束为 `NEEDS_HUMAN_REVIEW`。
5. 审核确认后通过最薄投影 Adapter 写入现有 `KeywordQuestionMap`，并保存生成运行与审核包关联。
6. 在 Provider Runtime OFF 下先提供确定性离线 Adapter 与 Contract 测试；本检查点不授权真实模型调用。

## 9. 当前 Gate

`STOP_BEFORE_IMPLEMENTATION`

原因：Agent B 的参考快照与审核包尚未实现；AI 拓词 Contract、运行模型和安全边界也尚无代码。下一步是评审本轮冻结 Contract，不是先接真实 Provider。
