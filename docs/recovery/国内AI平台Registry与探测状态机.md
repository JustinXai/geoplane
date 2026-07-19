# 国内 AI 平台 Registry 与探测状态机

状态：第一轮事实模型；**不是已实现代码，也不是恢复出的旧 schema**。

基线：`baf550d3fc17589de2b474706560107763176cf1`。

## 1. 分类声明

本文严格使用：`RECOVERED_IMPLEMENTED`、`RECOVERED_SPECIFIED_NOT_COMPLETED`、`REBUILT_EQUIVALENT`、`CURRENT_REBUILD_ADDITION`、`MISSING_REQUIRED_CAPABILITY`、`DEFERRED_BY_FROZEN_SCOPE`。

当前 registry 和探测状态机整体分类为 `MISSING_REQUIRED_CAPABILITY`。下述“建议契约”用于后续 P0 评审，不表示已经恢复或实现。

## 2. 当前 Registry 事实

| 产品 | 稳定键 | 产品 Registry | 探测 Adapter | 已确认接入方式 | 分类 |
|---|---|---|---|---|---|
| 豆包 | 未冻结 | 无 | 无 | 无 | `MISSING_REQUIRED_CAPABILITY` |
| 通义千问 | 未冻结 | 无 | 无 | 无 | `MISSING_REQUIRED_CAPABILITY` |
| DeepSeek | 未冻结 | 无 | 无 | 无；只有文章生成模型 API | `MISSING_REQUIRED_CAPABILITY` |
| 腾讯元宝 | 未冻结 | 无 | 无 | 无 | `MISSING_REQUIRED_CAPABILITY` |

### 2.1 不得混淆的三层身份

1. **用户产品**：豆包、通义千问、DeepSeek 用户产品、腾讯元宝。
2. **模型厂商/模型**：字节、阿里、DeepSeek、腾讯及具体模型版本。
3. **调用网关/协议**：例如阿里云模型服务网关、OpenAI-compatible。

当前 `ProviderIdentity` 只有第 2、3 层的部分字段，且服务于文章生成，分类为 `CURRENT_REBUILD_ADDITION`。它没有第 1 层，也没有产品表面、接入方式、地区和登录要求，不能直接充当探测 registry。

## 3. 建议的最小 Registry 契约（待冻结）

以下全部为 `MISSING_REQUIRED_CAPABILITY` 的建议形态：

| 字段 | 目的 | 约束建议 |
|---|---|---|
| `productKey` | 稳定引用产品 | 人工冻结，不由展示名生成 |
| `displayNameZh` | 中文展示名 | 不作为主键 |
| `surface` | `WEB / APP / API / SEARCH` | 与接入方式分开 |
| `accessMode` | 四类接入方式之一 | 见第 4 节 |
| `region` | 地区/语言上下文 | 不默认伪造 |
| `authenticationRequirement` | 无登录/用户登录/组织凭据 | 凭据本体不得入 registry |
| `modelDisclosure` | 产品是否披露底层模型 | 不披露时保存 `UNKNOWN`，不得猜测 |
| `enabled` | 是否允许进入调度 | 默认 `false` |
| `evidencePolicy` | 原始证据与脱敏策略版本 | 必填且版本化 |

## 4. 接入方式

| 接入方式 | 当前分类 | 建议语义 |
|---|---|---|
| `MANUAL_SAMPLE` | `MISSING_REQUIRED_CAPABILITY` | 经授权人员录入或导入的脱敏回答；必须记录来源、采样时间和人工操作者。 |
| `MODEL_API` | `MISSING_REQUIRED_CAPABILITY` | 产品/厂商正式模型 API；不能代表 Web/App 用户产品体验。 |
| `SEARCH_API` | `MISSING_REQUIRED_CAPABILITY` | 正式搜索/答案 API；需保留查询参数、地区和来源卡片。 |
| `WEB_PRODUCT` | `MISSING_REQUIRED_CAPABILITY` | 面向用户的网页产品；不得绕过登录、验证码或访问限制。 |

现有 OpenAI-compatible adapter 虽使用模型 API，但其业务端口是 `generateArticleContent()`，所以不是这里的 `MODEL_API` 探测 adapter。

## 5. 领域对象状态

| 对象 | 当前分类 | 最小职责（待冻结） |
|---|---|---|
| `BenchmarkQuestionSet` | `MISSING_REQUIRED_CAPABILITY` | 版本化问题集合、行业/项目范围、不可变发布快照。 |
| `ProbeRun` | `MISSING_REQUIRED_CAPABILITY` | 一次问题集 × 目标产品集合的运行及汇总状态。 |
| `RawProbeResult` | `MISSING_REQUIRED_CAPABILITY` | 单问题、单目标、单次尝试的原始证据和采集上下文。 |
| `Citation` | `MISSING_REQUIRED_CAPABILITY` | 从原始结果解析的引用位置、目标、规范化来源和置信度。 |
| `BrandMention` | `MISSING_REQUIRED_CAPABILITY` | 品牌、别名、位置、上下文、情感/排序候选和置信度。 |

约束建议：`Citation` 与 `BrandMention` 必须引用一个 `RawProbeResult` 并携带 parser version；不得只有汇总数字而无可追溯样本。

## 6. 当前不存在的状态机

代码、migration 和测试中没有 ProbeRun 状态机，分类为 `MISSING_REQUIRED_CAPABILITY`。旧 `VisibilityPage` 引用属于 `RECOVERED_SPECIFIED_NOT_COMPLETED`，不能提供状态机证据。

## 7. 建议状态机（P0 待评审）

建议状态名不是恢复事实；冻结前不得写 migration。

### 7.1 ProbeRun

```text
DRAFT
  -> READY
  -> RUNNING
  -> COMPLETED
             \
              -> COMPLETED_WITH_FAILURES

READY | RUNNING -> CANCELLED
RUNNING         -> FAILED
```

建议门禁：

- `DRAFT -> READY`：问题集版本、目标 registry 版本、证据策略和指标版本已固定。
- `READY -> RUNNING`：显式人工启动；至少一个目标启用；默认不允许真实连接。
- `RUNNING -> COMPLETED`：所有目标尝试都有终态且无失败。
- `RUNNING -> COMPLETED_WITH_FAILURES`：至少一个成功且至少一个失败；失败不得从指标分母中静默删除。
- `RUNNING -> FAILED`：没有可用结果或运行级不可恢复错误。
- `CANCELLED`：保留已产生的历史结果，不删除。

### 7.2 单目标尝试

```text
PENDING -> ACQUIRING -> CAPTURED -> PARSING -> PARSED
                    \-> ACQUISITION_FAILED
                                  \-> PARSE_FAILED
PENDING | ACQUIRING -> CANCELLED
```

建议失败分类至少区分：超时、限流、认证失败、访问受限、验证码/人工接管、空回答、契约无效、解析失败、人工样本证据不完整。不得把这些状态折叠成“无品牌提及”。

## 8. 指标计算门禁

四个核心指标名称和公式尚未恢复，分类为 `MISSING_REQUIRED_CAPABILITY`。状态机应只允许在以下条件同时满足后生成指标快照：

1. ProbeRun 已终态；
2. 问题集版本、registry 版本、parser version、metric version 固定；
3. 每个失败样本有明确分类；
4. 指标分母规则明确处理失败、拒答和人工样本；
5. 每个聚合值可回溯到 RawProbeResult；
6. 重算生成新版本，不覆盖历史结果。

在四指标正式口径冻结前，系统只能展示“尚未配置指标”，不能展示模拟数字。

## 9. 与现有 Provider 执行账本的关系

| 项目 | 现有 `provider_execution` | 建议探测运行时 |
|---|---|---|
| 分类 | `CURRENT_REBUILD_ADDITION` | `MISSING_REQUIRED_CAPABILITY` |
| 业务目的 | 文章内容生成调用 | 国内 AI 产品回答采样 |
| 业务上下文 | 项目 + 文章简报 | 问题集 + 问题 + 产品目标 + 尝试 |
| 原始回答 | 明确不保存 | 必须按经批准的证据策略保存或引用 |
| 引用/品牌提及 | 无 | 派生实体，需 parser version |
| 可否直接复用 | 否 | 只能参考默认关闭、幂等、错误分类和 append-only 原则 |

## 10. 冻结前禁止事项

- 不把 DeepSeek 文章生成测试写成 DeepSeek GEO 探测成功。
- 不为豆包、通义千问、腾讯元宝填写猜测的 endpoint、模型或接入方式。
- 不绕过登录、验证码、反自动化或产品条款。
- 不把采集失败算作“未提及”。
- 不保存密钥、Cookie、完整认证头。
- 不生成无法追溯到原始样本的正式指标。
- 不进行真实平台调用。

## 11. 评审顺序

1. 冻结 registry 与三层身份边界。
2. 冻结四种接入方式和合规证据策略。
3. 冻结五个领域对象及不可变/版本化规则。
4. 冻结四指标公式。
5. 以 `MANUAL_SAMPLE` 脱敏测试数据完成最小闭环。
6. 通过安全、审计、租户隔离和零真实调用测试后，再单独审批某一产品 adapter。

当前判定：`REGISTRY_NOT_IMPLEMENTED`、`PROBE_STATE_MACHINE_NOT_IMPLEMENTED`、`REAL_PROBE_CALLS_ALLOWED = NO`。
