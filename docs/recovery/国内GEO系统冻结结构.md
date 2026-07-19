# 国内 GEO 系统冻结结构

阶段：`DOMESTIC_GEO_PARALLEL_RECOVERY_V1`
安全基线：`local/closed-pilot-staging-v1@baf550d3fc17589de2b474706560107763176cf1`

## 1. 恢复性质

本项目是对被删除系统的事实恢复与当前重建底座的对账，不是新产品设计。执行顺序固定为：历史证据 → 原能力矩阵 → 当前恢复状态 → 缺失能力 → 并行恢复 → 后端集成 → 最后恢复 UI。

所有能力只能使用以下分类：

- `RECOVERED_IMPLEMENTED`：删除前存在真实代码、数据、测试或运行证据；
- `RECOVERED_SPECIFIED_NOT_COMPLETED`：恢复源能直接证明删除前存在规格或流程意图，但没有完整实现证据；
- `REBUILT_EQUIVALENT`：原代码缺失，当前重建提供等价能力；
- `CURRENT_REBUILD_ADDITION`：灾难重建新增，原系统没有明确证据；
- `MISSING_REQUIRED_CAPABILITY`：当前冻结目标要求、当前实现仍缺；本标签本身不证明删除前已有实现或规格；
- `DEFERRED_BY_FROZEN_SCOPE`：明确后置，本轮不开发。

没有直接证据的推测不得标记为 `RECOVERED_IMPLEMENTED`。

唯一政策例外：本阶段指令要求 AI 拓词默认标记为 `RECOVERED_SPECIFIED_NOT_COMPLETED`。该标签只表达所有者冻结的恢复目标，不表示已经找到删除前规格或生产实现；精确字段草案仍属 `CURRENT_REBUILD_ADDITION`，生产 Contract/runtime 仍属 `MISSING_REQUIRED_CAPABILITY`。

事实来源严格分三层：恢复证据（恢复源、partial source、可验证旧对象/运行封存）、灾后所有者重述的目标规格（当前 `docs/architecture/**` 与阶段指令）、当前重建事实（现有代码、Migration、测试和运行报告）。后两层不能单独证明删除前实现或删除前规格。

## 2. 产品定位

系统定位冻结为国内跨行业 GEO 内容生产、信源建设、AI 可见性验证与代理商交付系统。它不是通用 AI 写作器、海外模型控制台或单纯的多租户后台。

客户价值链：真实企业知识 → 真实需求信号 → 人工确认的问题与机会 → 有信源支撑的内容 → 人工门禁 → 交付 → 国内 AI 平台可见性验证。

指标口径冻结为四项核心比例：品牌曝光率、推荐进入率、已管理信源引用率、竞品声量份额；问题覆盖率与引用域名分布是辅助分析维度。不能用无法解释的总分替代底层指标。

## 3. 三层商业结构

### PLATFORM

管理代理商、客户、项目、行业与平台规则、国内 AI 平台适配器、数据源适配器、质量治理、审计和系统健康。

### AGENCY

只管理明确授权的客户，负责建档、资料补齐、关键词导入与确认、内容任务、信源任务、审核、交付和效果复盘。

### CLIENT

确认企业资料、关键词与用户问题、内容和信源，查看交付与效果报告。客户端不得暴露数据库结构、UUID、Hash、Provider、Schema、Migration 或内部英文技术对象。

## 4. 四层数据与 AI 边界

1. **系统生成模型**：用于知识结构化、AI 拓词、问题/机会/内容生成。DeepSeek 或国内 OpenAI-compatible 网关只是内部算力适配器。
2. **GEO 探测目标平台**：首批固定 `DOUBAO`、`QWEN`、`DEEPSEEK`、`YUANBAO`；高风险平台第一版允许 `MANUAL_SAMPLE`。
3. **真实需求数据**：首批为百度关键词规划师 XLSX/CSV。只有真实来源才能承载搜索量、推荐出价、竞争度并标记 `OBSERVED_DEMAND`/`CONFIRMED_DEMAND`。
4. **AI 拓词**：只能输出 AI 扩展、行业假设、知识支撑机会；不得伪造搜索量、出价、竞争度或百度需求，默认 `NEEDS_HUMAN_REVIEW`。

## 5. 跨行业 Core 与行业 Pack

Core 保持跨行业：KnowledgePackage、IndustryProfile、BusinessCapabilityGraph、KeywordContext、Opportunity、Source、Citation、Article、Publication、Probe、Metric。行业差异全部进入版本化 `VerticalPolicyPack`。

首个 Pack 为 `MEDICAL_AESTHETICS_V1`，但本轮只冻结 Contract、加载机制和当前目标规则类别；恢复源未证明删除前医美规则规格或实现。不得把医美、医院、医生、疗效或资质写死进 Core，也不得同时开发全部行业 Pack。

## 6. 门禁

内容交付依次受以下门禁约束：

- `CORE_QUALITY_GATE`；
- `PLATFORM_RULE_GATE`；
- `VERTICAL_RULE_GATE`；
- `SOURCE_GROUNDING_GATE`；
- `HUMAN_REVIEW_GATE`。

当前 Core Quality Gate 可按恢复目标语义判定为 `REBUILT_EQUIVALENT`；当前 Platform/Vertical Gate 是 `CURRENT_REBUILD_ADDITION`，只能作为未来 Pack 规则的结果载体。Article Approval 可按人工批准语义判定为 `REBUILT_EQUIVALENT`。独立信源门禁及 Pack 驱动规则仍需恢复。Human Review 与 Article Approval 永不自动通过。

## 7. 冻结边界

- Provider Runtime 保持关闭；禁止真实 Provider 调用与 Cookie 自动化登录；
- 自动批准关闭、自动发布关闭、默认渠道数 0；
- 真实客户数据为 0；
- P0 Contract 与恢复证据形成前禁止正式 UI/Taste 重建；
- 计费、自动分佣、复杂订阅、完整白标、自动化高风险 Probe 和更多行业 Pack 后置。
