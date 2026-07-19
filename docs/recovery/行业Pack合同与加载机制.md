# 行业 Pack 合同与加载机制（P0 冻结草案）

本文件是 `CURRENT_REBUILD_ADDITION` 的恢复规格草案，不代表删除前源码或删除前冻结规格，也不授权本轮大规模实现。对应生产 Contract、Registry、Loader 与门禁接线仍为 `MISSING_REQUIRED_CAPABILITY`。

## 最小 Contract

`VerticalPolicyPack` 必须包含：

- `packId`：稳定标识，首个为 `MEDICAL_AESTHETICS_V1`；
- `verticalSlug` 与不可变 `version`；
- `evidenceReferences`：每条恢复规则的证据引用；
- `platformRules`、`verticalRules`、`sourceGroundingRules`；
- `mandatoryHumanReview`：是否强制人工复核；
- `riskTerms` 与对应处理动作；
- `effectiveFrom`，不得无版本覆盖旧规则。

规则输出只允许 `PASSED` 或带非空原因的 `FAILED`。没有匹配 Pack、版本未知、规则解析失败、信源不足时必须失败关闭或转人工审核，绝不能默认通过。

## Loader 边界

1. Core 仅依赖 `VerticalPolicyPackPort.get(packId, version)`，不依赖医美字段。
2. Registry 只注册经过证据核验的版本；同一 `(packId, version)` 不得被覆盖。
3. `IndustryProfile` 保存 Pack 标识/版本的映射需要后续兼容设计；不得破坏当前 `ruleSetVersion`。
4. 门禁运行记录保存 Pack 版本和规则结果，不把规则正文复制进业务实体。
5. 第一版只允许本地静态 Registry；外部配置与在线更新后置。

## MEDICAL_AESTHETICS_V1 证据边界

当前只冻结规则类别：医疗广告边界、疗效承诺限制、机构与人员资质、风险词、事实信源要求、强制人工审核。恢复源尚未发现可证明具体规则文本和阈值的文件，因此不得凭经验补写具体条款。

## 验收矩阵

- Core 无行业硬编码；
- 未知 Pack/版本失败关闭；
- Pack 结果可追溯到证据与版本；
- 信源不足不能通过；
- Human Review 永不自动通过；
- 旧文章主链和当前 PostgreSQL Gate 表保持兼容。
