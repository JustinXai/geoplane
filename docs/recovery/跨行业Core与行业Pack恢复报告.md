# 跨行业 Core 与行业 Pack 恢复报告

阶段：`DOMESTIC_GEO_PARALLEL_RECOVERY_V1` 第一检查点  
安全基线：`baf550d3fc17589de2b474706560107763176cf1`

## 结论

当前重建已经形成可运行的跨行业文章主链与三类文章门禁，但这些实现明确标注为从冻结规格重建，不能记为删除前源码恢复。删除前证据只足以确认文章 Brief、人工审核和版本化发布准备流程真实存在；`VerticalPolicyPack`、医美规则包以及 `SOURCE_GROUNDING_GATE` 没有恢复到真实实现证据。

因此本工作流当前状态为：核心主链 `REBUILT_EQUIVALENT`，行业 Pack 机制 `MISSING_REQUIRED_CAPABILITY`，医美具体规则 `RECOVERED_SPECIFIED_NOT_COMPLETED`。

## 证据与事实分类

| 能力 | 分类 | 证据 | 当前事实 |
|---|---|---|---|
| ArticleBrief 与人工审核主链 | RECOVERED_IMPLEMENTED | `E:\GEO_RECOVERY_SAFE\GEO_CONTROL_PLANE_CHECKPOINT\TODAY_NODE_RECOVERY_MATRIX.md`；`docs/rebuild/recovered-evidence/TARGET_STATE_MANIFEST.md` | 恢复记录包含 `buildArticleBriefOfflineV1` 测试故事、OPR-01B 封存提交和人工批准状态；原完整源码树不可展开。 |
| KnowledgePackage / IndustryProfile / Opportunity / Article | REBUILT_EQUIVALENT | `src/contracts/geo-business/entities.ts` 文件头；`migrations/0002_knowledge_runtime.sql` 至 `0005_runtime_continuity.sql`；运行时测试 | 当前实现有 Contract、PostgreSQL 持久化、服务和 E2E，但源码明确是按冻结规格重建。 |
| CORE_QUALITY_GATE 对应通用质量门禁 | REBUILT_EQUIVALENT | `src/runtime/geo/services/quality-gate-service.ts`；`tests/contracts/geo-business-quality-gate.test.ts` | 当前 `QualityGate` 是确定性门禁，有失败原因且不可静默通过。 |
| PLATFORM_RULE_GATE / VERTICAL_RULE_GATE 概念 | REBUILT_EQUIVALENT | `PlatformGate`、`VerticalGate`、`migrations/0004_geo_article_delivery.sql` | 当前已重建平台/行业门禁结果及持久化；恢复证据中这些原字面标识为 0 命中。 |
| HUMAN_REVIEW_GATE / Article Approval | REBUILT_EQUIVALENT | `human_review_decision`、`article_approval` 约束；HTTP/E2E 测试 | 明确人工身份与时间，不能自动批准。 |
| SOURCE_GROUNDING_GATE | MISSING_REQUIRED_CAPABILITY | 当前仓库无同等独立 Gate Contract、结果表或测试 | 现有 Opportunity 要求知识包来源，但没有针对高风险事实与 Citation 的独立信源门禁。 |
| VerticalPolicyPack Contract/Registry/Loader | MISSING_REQUIRED_CAPABILITY | `rg VerticalPolicyPack` 无实现命中 | 当前只有 `IndustryProfile.verticalSlug/ruleSetVersion`，没有版本化 Pack 定义、加载与解析失败策略。 |
| MEDICAL_AESTHETICS_V1 | RECOVERED_SPECIFIED_NOT_COMPLETED | 当前阶段冻结要求；恢复源未发现实现文件 | 只能记录为已指定未完成，不能声称删除前已上线。 |
| 其他行业 Pack | DEFERRED_BY_FROZEN_SCOPE | 本阶段冻结范围 | 本轮禁止同时开发制造、教育、食品、本地服务细节。 |

## Core 行业中立性审计

生产 Core 未发现医生、医院、医美项目、疗效或资质规则的硬编码执行分支。测试和注释中的 healthcare 示例不构成运行规则。当前跨行业边界可以直接复用，但后续 Pack 必须通过端口注入，不能向 `KnowledgePackage`、`Opportunity` 或 `Article` 写入医美专属字段。

## P0 差距

1. 冻结 `VerticalPolicyPack` 版本化 Contract、Registry 与 Loader。
2. 明确 Pack 能提供的平台规则、行业规则、信源要求和强制人工审核策略。
3. Loader 必须未知 Pack/版本时失败关闭，不得回退为自动通过。
4. 将已有 `QualityGate`、`PlatformGate`、`VerticalGate` 作为结果载体复用，避免重建文章链。
5. `SOURCE_GROUNDING_GATE` 依赖 Agent C 的 Source/Citation Contract，未冻结前只保留端口位置。

## 第一检查点判定

`PASS_WITH_GAPS`：跨行业 Core 可复用；行业 Pack Contract 与信源门禁仍是 P0 缺口。第一轮不修改生产代码。
