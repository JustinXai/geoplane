# AI 拓词 Contract 与人工审核状态机

## 1. 文档状态

本文冻结 AI 拓词与用户问题生成的 P0 Contract 和审核状态机。精确字段是恢复目标设计，不是原代码逐字恢复，整体分类为 `RECOVERED_SPECIFIED_NOT_COMPLETED`；当前实现状态为 `MISSING_REQUIRED_CAPABILITY`。

必须维持：

- Provider Runtime 默认关闭。
- 自动批准：NO。
- AI 输出默认 `NEEDS_HUMAN_REVIEW`。
- 需求指标由真实参考源观察提供，AI 不生成。
- 只有人工确认结果可以进入当前 `KeywordQuestionMap → Opportunity` 链。

## 2. Contract 名称

P0 冻结两个顶层 Contract：

- `AIKeywordExpansionRequestV1`
- `AIKeywordExpansionResultV1`

辅助输出对象：

- `AIKeywordCandidateV1`
- `UserQuestionV1`
- `SearchExpressionV1`
- `GenerationSourceSnapshotRefV1`

这些名称与结构均未实现：`MISSING_REQUIRED_CAPABILITY`。

## 3. 输入 Contract

```ts
interface AIKeywordExpansionRequestV1 {
  schemaVersion: "AIKeywordExpansionRequestV1";
  generationRunId: string;
  idempotencyKey: string;
  clientOrganizationId: string;
  projectId: string;
  locale: "zh-CN";
  modelAdapterVersion: string;
  promptVersion: string;
  sourceSnapshots: readonly [
    GenerationSourceSnapshotRefV1,
    ...GenerationSourceSnapshotRefV1[],
  ];
  industryProfileSnapshot: {
    industryProfileId: string;
    ruleSetVersion: number;
    snapshotHash: string;
  };
  seedKeywords: readonly string[];
  requestedOutputs: {
    expandedKeywords: true;
    userQuestions: true;
    searchExpressions: true;
  };
}

interface GenerationSourceSnapshotRefV1 {
  snapshotType:
    | "KNOWLEDGE_PACKAGE"
    | "KEYWORD_REFERENCE_SNAPSHOT"
    | "KEYWORD_CLASSIFICATION_VERSION";
  snapshotId: string;
  snapshotVersion: string;
  snapshotHash: string;
}
```

### 3.1 输入不变量

1. `generationRunId` 由服务端生成并与租户、项目绑定；请求体不得自报其他租户。
2. `modelAdapterVersion`、`promptVersion` 必填且不可使用 `latest`、空值或隐式默认。
3. `sourceSnapshots` 非空；每项必须是封存、不可变、同租户/项目的快照。
4. `KNOWLEDGE_PACKAGE` 固定真实知识包 id + version/hash；`KEYWORD_REFERENCE_SNAPSHOT` 和 `KEYWORD_CLASSIFICATION_VERSION` 对应 Agent B 目标 Contract。
5. `industryProfileSnapshot` 固定画像与规则版本；生成过程中画像变化不影响本次运行。
6. `seedKeywords` 只用于引导，不带搜索量、热度或需求强弱。
7. 进入 Adapter 前由服务端生成规范化 `requestHash`；相同 scope + idempotency key + requestHash 只能对应一个逻辑运行。
8. 传给模型的内容必须经过字段白名单和最小化处理；不包含客户秘密、凭据、内部 id 列表或未授权知识全文。

## 4. 输出 Contract

```ts
type AIKeywordMarker =
  | "AI_EXPANDED_KEYWORD"
  | "INDUSTRY_HYPOTHESIS"
  | "KNOWLEDGE_GROUNDED_OPPORTUNITY";

type AIReviewStatus = "NEEDS_HUMAN_REVIEW";

interface AIKeywordExpansionResultV1 {
  schemaVersion: "AIKeywordExpansionResultV1";
  generationRunId: string;
  modelAdapterVersion: string;
  promptVersion: string;
  sourceSnapshots: readonly [
    GenerationSourceSnapshotRefV1,
    ...GenerationSourceSnapshotRefV1[],
  ];
  candidates: readonly AIKeywordCandidateV1[];
}

interface AIKeywordCandidateV1 {
  candidateId: string;
  keyword: string;
  normalizedKeyword: string;
  markers: readonly [AIKeywordMarker, ...AIKeywordMarker[]];
  userQuestions: readonly UserQuestionV1[];
  searchExpressions: readonly SearchExpressionV1[];
  sourceSnapshots: readonly [
    GenerationSourceSnapshotRefV1,
    ...GenerationSourceSnapshotRefV1[],
  ];
  confidence: number;
  reason: string;
  status: AIReviewStatus;
}

interface UserQuestionV1 {
  questionId: string;
  text: string;
  locale: "zh-CN";
  confidence: number;
  reason: string;
  status: AIReviewStatus;
}

interface SearchExpressionV1 {
  expressionId: string;
  text: string;
  locale: "zh-CN";
  confidence: number;
  reason: string;
  status: AIReviewStatus;
}
```

### 4.1 输出不变量

1. `generationRunId`、`modelAdapterVersion`、`promptVersion` 必须与输入完全一致；Adapter 无权改写。
2. `markers` 只能使用三项精确值；禁止新增同义值。
3. `status` 唯一允许的模型输出值是 `NEEDS_HUMAN_REVIEW`。模型不能输出 `CONFIRMED`、`APPROVED` 或发布状态。
4. `sourceSnapshots` 非空，且必须是输入快照的子集；模型不能发明 snapshot id。
5. `confidence` 为闭区间 `[0,1]` 的上下文匹配自评；不是需求分数，不能触发自动批准。
6. `reason` 是简短、可展示的依据摘要，必须说明关联的知识/行业上下文；不得要求或保存模型隐藏思维链。
7. `keyword`、问题和表达式均非空；规范化后相同候选在同一运行内去重。
8. 每个 UserQuestion/SearchExpression 自身也默认 `NEEDS_HUMAN_REVIEW`，候选确认不自动确认其所有子项。
9. 结果不得携带 Token、Key、完整 Prompt、内部 Endpoint 或原始 Provider envelope。

## 5. 三类 AI 标记语义

```text
AI_EXPANDED_KEYWORD
  = 从 seed keyword + 冻结快照扩展出的词候选

INDUSTRY_HYPOTHESIS
  = 对行业相关性的待审假设，不是事实

KNOWLEDGE_GROUNDED_OPPORTUNITY
  = 明确可回溯到 sourceSnapshots 的内容方向候选，
    仍不是当前正式 Opportunity
```

同一候选可携带多项标记，但至少一项。`UserQuestion` 与 `SearchExpression` 是对象类型，不能作为 marker；`CONFIRMED_DEMAND` 不得由 AI 生成或标记。

## 6. 需求指标结构性禁令

输入/输出顶层、candidate、UserQuestion、SearchExpression 均禁止出现：

```text
searchVolume / monthlySearchVolume / demandIndex / searchIndex
heat / trend / growth / competition / difficulty
cpc / traffic / ctr / rank / rankingProbability
```

运行时验证必须同时检查字段名与语义：即使字段改名为 `score`，只要表达需求量、热度或流量预测，也必须拒绝。合法的 `confidence` 只解释上下文匹配，不允许在 UI 改名为“需求分”“热度”或“机会指数”。

未来真实需求指标只来自 Agent B 的 `KeywordDemandObservation`，需要来源、口径、周期、地域、设备和参考快照；AI Contract 对该对象只允许引用 id，不允许生成数值。

## 7. Generation Run

### 7.1 运行身份

建议 `ai_keyword_generation_run` 保存：

- `id`（即 `generation_run_id`）
- `client_organization_id`, `project_id`
- `idempotency_key`, `request_hash`
- `model_adapter_version`, `prompt_version`
- `requested_by_user_id`, `requested_at`
- 不可变 source snapshot 引用清单

运行状态由 append-only `ai_keyword_generation_run_event` 派生：

```text
REQUESTED
  -> INPUTS_FROZEN
  -> RUNNING
  -> SUCCEEDED
  -> FAILED
  -> CANCELLED
```

- `INPUTS_FROZEN` 前不得调用 Adapter。
- `RUNNING` 不能直接变成审核通过；`SUCCEEDED` 只表示生成 Contract 校验通过。
- 重试创建新 run 并引用原 run；失败运行不可原地覆盖。
- Provider Runtime OFF 时，只允许确定性离线 Adapter；真实调用为 `DEFERRED_BY_FROZEN_SCOPE`。

## 8. 人工审核状态机

### 8.1 单项状态

```text
NEEDS_HUMAN_REVIEW
  -> CONFIRMED
  -> CHANGES_REQUESTED
  -> DEFERRED
  -> REJECTED

CHANGES_REQUESTED
  -> 新 generation run / 新 candidate
  -> NEEDS_HUMAN_REVIEW
```

规则：

1. 数据库默认值只能是 `NEEDS_HUMAN_REVIEW`，且 Adapter 返回其他状态必须被 Contract 校验拒绝。
2. `CONFIRMED` 必须有真实 reviewer、reviewedAt 和明确决定；actor 从签名会话派生。
3. `CHANGES_REQUESTED`、`DEFERRED`、`REJECTED` 必须有中文理由。
4. 决定采用 append-only；改变决定写新版本，不修改旧记录。
5. `confidence=1` 也不能跳过审核。
6. 父 candidate 与每个 UserQuestion/SearchExpression 分开审核；不得打包默认全选。

### 8.2 HumanReviewPackage

与 Agent B 的 `HumanReviewPackage` 接线：

```text
AIKeywordExpansionResultV1
  -> KeywordFamilyDraft
  -> HumanReviewPackage(OPEN)
  -> IN_REVIEW
  -> COMPLETED
```

包 `COMPLETED` 只表示所有项目已有明确决定，不等于全部确认。包内每项决定仍按上面的单项状态保存。

## 9. 投影到当前业务链

仅以下链路允许：

```text
已冻结 source snapshots
  -> AI 生成（全部 NEEDS_HUMAN_REVIEW）
  -> KeywordFamilyDraft
  -> HumanReviewPackage
  -> 人工逐项 CONFIRMED
  -> 投影为 KeywordQuestionMap entries
  -> 当前 Opportunity 创建与规则校验
  -> 当前 HumanReviewDecision
```

投影必须保存：

- `generation_run_id`
- `candidate_id`
- `human_review_package_id`
- `review_decision_id`
- `source_snapshot_refs`
- `model_adapter_version`
- `prompt_version`

如果当前 `KeywordQuestionMap` Contract 不能承载这些字段，应新增 append-only 关联表，不得把追溯信息塞进展示文案，也不得丢弃。

## 10. Adapter 边界

拓词应使用独立 `AIKeywordExpansionAdapter`，不修改当前 `ProviderPort.generateArticleContent`：

```ts
interface AIKeywordExpansionAdapter {
  generate(
    request: AIKeywordExpansionRequestV1,
  ): Promise<AIKeywordExpansionResultV1>;
}
```

Adapter 只生成候选内容，不能：

- 写数据库或审计决定；
- 创建正式 Opportunity；
- 输出需求指标；
- 输出审核/批准/发布结论；
- 访问请求未列出的快照；
- 返回完整 Prompt、秘密或原始响应 envelope。

## 11. P0 测试门

| 层级 | 必须验证 |
|---|---|
| Contract | 必填 generation/model/prompt/source snapshots；三类 marker 闭集；输出状态固定 |
| Forbidden metrics | 字段名和语义变体均拒绝；confidence 不可映射为需求分 |
| Tenant | 快照、行业画像、运行、候选、审核包同租户/项目；跨租户拒绝 |
| Determinism | 离线 Adapter 相同 requestHash 输出一致；不读时钟/随机数生成业务内容 |
| Idempotency | 同 key + 同 hash 返回同一逻辑运行；同 key + 不同 hash 冲突 |
| Versioning | model/prompt/source snapshot 任一变化产生新 run；旧结果不可修改 |
| Human review | 无 reviewer 不可确认；confidence 不可自动确认；子项不自动全选 |
| Projection | 仅 CONFIRMED 项投影；追溯字段完整；未审核项不进入现有链 |
| Provider safety | 默认 OFF 下真实 Adapter 调用为 0；无 Key/Endpoint/Prompt 泄漏 |

## 12. Gate

当前判定：`STOP_BEFORE_IMPLEMENTATION`。

在 Agent B 的 `KeywordReferenceSnapshot`、`KeywordFamilyDraft`、`HumanReviewPackage` 与本 Contract 共同评审通过前，不创建迁移、不接真实模型、不向现有 KeywordQuestionMap 写 AI 候选。

