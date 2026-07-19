# 国内 AI 探测恢复报告

调查代号：`CHINA_AI_PROBE_RUNTIME_RECOVERY`（第一轮事实核对）

基线：`baf550d3fc17589de2b474706560107763176cf1`

日期：2026-07-19

边界：只读检查恢复源、当前 migrations/tests/contracts/runtime/docs 及指定外部候选源；未联网、未调用真实模型、未修改恢复源。

## 1. 结论

**当前没有恢复或重建出可运行的“国内 AI GEO 探测运行时”。**

- 豆包、通义千问、腾讯元宝：没有 registry、adapter、测试或数据库模型。
- DeepSeek：当前只存在“文章内容生成 Provider”，不是 GEO 探测目标产品 adapter。
- `MANUAL_SAMPLE / MODEL_API / SEARCH_API / WEB_PRODUCT`：探测语义下均未实现。
- `BenchmarkQuestionSet / ProbeRun / RawProbeResult / Citation / BrandMention`：当前代码和九个 migration 中均不存在。
- 旧系统只留下 `VisibilityPage` 模块引用的部分证据；实现和数据模型均未恢复。
- 四个核心指标没有找到可验证的名称全集、公式、分母、失败样本处理或版本规则。
- 外部候选源 `D:\Documents\国内GEO系统\geo-open-source-evaluation` 不存在：`SOURCE_NOT_AVAILABLE`。

最终判定：`CHINA_AI_PROBE_RUNTIME_NOT_RECOVERED`。

## 2. 本报告唯一使用的六类事实

| 分类 | 定义 |
|---|---|
| `RECOVERED_IMPLEMENTED` | 恢复证据足以确认旧系统存在已实现、可识别的能力。 |
| `RECOVERED_SPECIFIED_NOT_COMPLETED` | 恢复证据确认旧系统曾指定或引用该能力，但没有足够证据证明实现闭合。 |
| `REBUILT_EQUIVALENT` | 当前重建已实现与恢复目标等价的业务能力。 |
| `CURRENT_REBUILD_ADDITION` | 灾后重建新增能力；不能反向声称旧系统曾有同一实现。 |
| `MISSING_REQUIRED_CAPABILITY` | 当前目标所需但恢复证据和当前实现均不具备的能力。 |
| `DEFERRED_BY_FROZEN_SCOPE` | 冻结范围明确延期，未实现符合当时边界。 |

没有证据的项目不标为 `RECOVERED_IMPLEMENTED` 或 `REBUILT_EQUIVALENT`。

## 3. 证据范围

### 3.1 已检查

- `E:\GEO_RECOVERY_SAFE`（只读）
- `recovered/partial-source/**`
- `docs/rebuild/recovered-evidence/**`
- `migrations/**`（`0001` 至 `0009`）
- `src/contracts/**`、`src/runtime/**`
- `tests/**`
- `docs/architecture/**`、`docs/product-runtime/**`、`docs/pilot/**`
- `D:\Documents\国内GEO系统\geo-open-source-evaluation`

### 3.2 检索词

`豆包/doubao`、`通义/qwen/千问`、`DeepSeek`、`腾讯元宝/yuanbao`、`MANUAL_SAMPLE`、`MODEL_API`、`SEARCH_API`、`WEB_PRODUCT`、`BenchmarkQuestionSet`、`ProbeRun`、`RawProbeResult`、`Citation`、`BrandMention`、`probe`、`benchmark`、`visibility`、`mention`、`citation`、`可见性`、`监测`、`提及`、`引用`。

## 4. 恢复证据

| 事实 | 分类 | 证据与边界 |
|---|---|---|
| 旧系统曾引用 `VisibilityPage` | `RECOVERED_SPECIFIED_NOT_COMPLETED` | `docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md:32` 记录 `import { VisibilityPage } from "@/components/control-plane/pages"`；模块实现未恢复。 |
| Provider 辅助文章修订主链曾运行 | `RECOVERED_IMPLEMENTED` | 恢复矩阵记录 OPR-01B 的 execution、失败码、人工批准与封存证据；这是文章生产能力，不是 AI 产品探测。 |
| 国内四平台探测 registry | `MISSING_REQUIRED_CAPABILITY` | 恢复源对豆包、通义千问、腾讯元宝无命中；DeepSeek 命中均不构成探测 registry。 |
| 国内 AI 探测数据模型 | `MISSING_REQUIRED_CAPABILITY` | 恢复源未发现问题集、探测运行、原始结果、引用、品牌提及实体。 |
| 可见性监测在冻结蓝图中为 P4 placeholder | `DEFERRED_BY_FROZEN_SCOPE` | `docs/architecture/SYSTEM_BLUEPRINT_V1.md:44-51` 与 `docs/rebuild/REBUILD_MASTER_PLAN.md:98-99`。 |

恢复证据能证明“可见性概念曾被引用”，不能证明四平台 registry、四种接入方式、探测状态机或指标公式曾完成。

## 5. 当前重建事实

### 5.1 文章生成 Provider

当前 Provider runtime 是灾后重建新增，源码头明确标为 `RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)`，因此统一分类为 `CURRENT_REBUILD_ADDITION`：

- `ProviderPort.generateArticleContent()` 输入含 `articleBriefId`，输出为 `ProviderArticleContentV1`（`src/runtime/provider/provider-port.ts:51-123`）。
- Provider 身份只表达网关、模型厂商与协议（`src/runtime/provider/identity.ts:36-90`）。
- 默认身份是 `ALIYUN_MAAS / DEEPSEEK / OPENAI_COMPATIBLE`。
- `provider_execution` 按文章简报记录模型、状态、Token 与耗时（`migrations/0007_provider_ledger.sql:66-91`）。
- 表结构明确不保存 prompt、response 或内容文本（`0007:26-34`；`0008_provider_identity.sql:19-26`）。
- Provider 默认关闭（`src/runtime/provider/feature-flag.ts:9-39`）。

判定：该边界可以作为未来通用网络调用、安全开关和执行账本设计的参考，但它不等价于探测运行时，分类不能升级为 `REBUILT_EQUIVALENT`。

### 5.2 唯一真实模型测试

`docs/pilot/PROVIDER_MICRO_CANARY_REPORT.md:12-40` 记录一次 `deepseek-v4-flash` 受控调用，经阿里云模型服务网关完成文章内容契约验证。其分类为 `CURRENT_REBUILD_ADDITION`，不是旧能力恢复；它没有采集 DeepSeek Web 产品回答，也没有覆盖豆包、通义千问或腾讯元宝。

## 6. 逐项分类矩阵

| 项目 | 分类 | 状态 |
|---|---|---|
| 旧 `VisibilityPage` 概念 | `RECOVERED_SPECIFIED_NOT_COMPLETED` | 有模块引用，无实现、表或指标证据 |
| 历史文章 Provider 辅助修订 | `RECOVERED_IMPLEMENTED` | 已确认，但属于文章生产相邻能力 |
| 当前 OpenAI-compatible 文章 Provider | `CURRENT_REBUILD_ADDITION` | 已实现、默认 OFF，不是探测 adapter |
| 国内 AI 探测等价重建 | `MISSING_REQUIRED_CAPABILITY` | 没有 `REBUILT_EQUIVALENT` 项 |
| 可见性正式产品模块 | `DEFERRED_BY_FROZEN_SCOPE` | 冻结蓝图明确为 P4 placeholder |
| 豆包 registry/adapter | `MISSING_REQUIRED_CAPABILITY` | 0 命中 |
| 通义千问 registry/adapter | `MISSING_REQUIRED_CAPABILITY` | 0 命中 |
| DeepSeek 探测 registry/adapter | `MISSING_REQUIRED_CAPABILITY` | 只有文章生成 Provider |
| 腾讯元宝 registry/adapter | `MISSING_REQUIRED_CAPABILITY` | 0 命中 |
| 四种探测接入方式 | `MISSING_REQUIRED_CAPABILITY` | 0 个探测契约命中 |
| 五类探测领域实体 | `MISSING_REQUIRED_CAPABILITY` | 代码/测试/migration 均为 0 |
| 四个核心指标公式 | `MISSING_REQUIRED_CAPABILITY` | 无正式口径和版本规则 |

## 7. 四个核心指标事实核对

调查目标提到“四个核心指标”，但本轮证据没有给出可验证的四个正式名称及公式。`Citation` 与 `BrandMention` 只能说明引用、品牌提及是候选解析维度，不能据此推导四项指标。

以下关键口径全部缺失，分类为 `MISSING_REQUIRED_CAPABILITY`：

- 一次回答多次提及如何计数；
- 超时、拒答、登录墙与采集失败是否进入分母；
- 显式链接、域名文本、来源卡片和语义归因中哪些算引用；
- 首提/排名按品牌顺序、段落位置还是产品排序；
- 情感按句子、品牌还是整份回答计算；
- 多轮次、多地区、多账号如何聚合；
- 指标公式和解析器如何版本化。

在产品所有者冻结名称、分子、分母和异常处理前，不应生成正式指标数字。

## 8. 外部源

指定路径：`D:\Documents\国内GEO系统\geo-open-source-evaluation`

结果：`SOURCE_NOT_AVAILABLE`

分类：`MISSING_REQUIRED_CAPABILITY`（外部参考输入不可用）

本轮未联网寻找替代项目，避免把未经指定的外部实现误写为恢复证据。

## 9. 缺口与建议

### P0：编码前冻结

1. 国内 AI 产品 registry：稳定 key、产品名、产品表面（App/Web/API/Search）、接入方式、地区、登录要求、启停状态；严格区分网关、模型厂商和用户产品。
2. 四种接入方式语义与证据要求；不得假设所有 Web 产品都存在公开模型 API。
3. `BenchmarkQuestionSet` 及不可变版本快照。
4. `ProbeRun`、单目标尝试、幂等键、失败分类、地区/账号/时间上下文。
5. `RawProbeResult` 的来源、授权、脱敏、保留期限和不可变策略。
6. `Citation`、`BrandMention` 的定位、规范化、置信度、解析器版本和人工修订审计。
7. 四个指标的正式名称、分子/分母、异常样本和版本规则。
8. 默认 OFF、零绕过登录/验证码、凭据不入库、真实调用单独审批。

### P1：P0 评审后

1. 先用 `MANUAL_SAMPLE` 脱敏样本完成最小闭环，不连接真实国内平台。
2. 原始结果 append-only；派生解析按 parser/metric version 可重算。
3. 建立 product adapter port，再按产品逐一实现，Web 产品不强行伪装成模型 API。
4. 用纯测试样本覆盖无提及、多品牌、显式/隐式引用、拒答、混合情感和解析失败。
5. 增加租户隔离、幂等、审计、凭据扫描、默认关闭与零真实调用回归测试。

## 10. 最终事实判定

- `RECOVERED_IMPLEMENTED`：只确认相邻的 Provider 辅助文章生产能力；未确认探测运行时。
- `RECOVERED_SPECIFIED_NOT_COMPLETED`：`VisibilityPage` 概念。
- `REBUILT_EQUIVALENT`：**0 项**。
- `CURRENT_REBUILD_ADDITION`：文章生成 Provider、执行账本、默认关闭开关、一次受控模型测试。
- `MISSING_REQUIRED_CAPABILITY`：国内平台 registry、四接入方式、五实体、探测状态机、四指标公式。
- `DEFERRED_BY_FROZEN_SCOPE`：可见性/监测正式模块。

下一步：评审 P0 契约；在契约冻结前不进行真实产品探测。
