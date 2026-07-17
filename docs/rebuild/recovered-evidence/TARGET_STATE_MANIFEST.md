# TARGET_STATE_MANIFEST

来源：用户在对话中提供的"项目冻结记录"内容。本文件如实记录用户提供的目标声明，并逐条标注**本次会话内实际验证结果**。未标注"已验证"的条目，一律视为未核实声明，不作为确定性事实使用。

生成时间：2026-07-17（会话内）
证据范围：`F:\GEO_CONTROL_PLANE_CHECKPOINT`（git-object-database / worktree-metadata / recovered-orphan-source-files）、`D:\Documents` 只读检查

---

## 1. 主线 HEAD 与已知集成节点

| 声明角色 | SHA | 验证结果 |
|---|---|---|
| 主线目标 HEAD | `0c3a40a3b71a25eaaaf6f7405b4eb56d0606d927` | **commit 对象已确认存在**。message: `chore(governance): close channel-neutral distribution correction`；author time `1784201493`(+0800)；parent `3734345bbbcb5c2db9d9d71e4f8e151c36443ee5`。**根 tree（72aced53…）已损坏，无法展开文件清单**。 |
| Candidate 3 集成提交 | `234eb7c1871c716ca4c744d45485608cba1a0099` | **未找到**。当前恢复出的 117 个有效 commit 对象中不存在此 SHA。不能证明其"不存在过"，只能证明"当前未恢复到"。 |
| 较早重要集成节点 | `a90862820d8af759cb57a8da5165853fba821c79` | **commit 对象已确认存在**。message: `chore(governance): register offline pipeline and close integration`；author time `1784129850`；parent `cd723e98e9472f8767db6fb5901a8be6ef8806be`。同时是主仓库与 `human-review-packets` worktree 两处的 `ORIG_HEAD`。**根 tree（6a7bec2a…）已损坏**。 |
| Master Content Hash | `8b28a6e3cc811836c607cbfe7c298323c172928d2a5786cecea7338b00630957` | **未找到**。在全部已恢复 commit message、120 个有效 blob 内容、worktree 元数据中均未搜到此字符串。 |

补充发现（非用户声明，本次会话独立找到）：commit message 中含 "candidate3 / candidate 3" 字样的还有 5 个，时间均早于 `0c3a40a3`（`1784173199`〜`1784195747`），SHA 见 `TODAY_NODE_RECOVERY_MATRIX.md` 附录。

## 2. 已冻结领域模型 / 关键类型与枚举名

用户提供的符号列表与本次会话对 **117 个 commit message + 120 个有效 blob 内容 + 孤立恢复源码文件** 的全文搜索结果：

| 符号 | 命中情况 |
|---|---|
| ChannelNeutralContentPackageV1 / DistributionPlanV1 / PlatformContentAdapterV1 / PlatformPublicationPackageV1 | **0 命中**（含变体后缀搜索） |
| KnowledgeDocument / KnowledgeVersion / KnowledgeChunk / KnowledgeSnapshot / KnowledgeIssue | **0 命中**逐字匹配；但代码中出现过 `required_knowledge_references`、`"chunk-a"` 等**概念相关的字段/字符串**，提示"知识引用"机制确实存在，只是类型命名未必与声明的 PascalCase 完全一致 |
| ArticleExecutionContext / ArticleOpportunity / ArticleFamily | **0 命中** |
| ArticleBrief | **4 处命中**，含真实、可读、语法完整的代码：`ArticleBriefCandidateV1Schema`、`ArticleBriefPlanningContextV1`、`BRIEF_PLANNING_CONTEXT_REQUIRED`、函数 `buildArticleBriefOfflineV1()`、真实文件路径 `src/opportunity/article-brief-offline-v1.ts`、`src/opportunity/fixtures/article-brief-fixtures.redacted.json` |
| PublishPackage | **3 处命中**：`"schema_version": "PublishPackageReadinessV1"` |
| PublicationPackage | 0 命中 |
| PLATFORM_RULE_GATE / VERTICAL_RULE_GATE / NEEDS_HUMAN_REVIEW / KNOWLEDGE_GROUNDED_OPPORTUNITY / INDUSTRY_HYPOTHESIS / CONFIRMED_DEMAND | **0 命中**逐字匹配；但发现同义/相近状态值实际使用：`HUMAN_REVIEW_REQUIRED`、`REJECTED`（来自真实 vitest 测试断言） |

**结论**：用户提供的领域模型描述**方向大体可信**（"article brief / opportunity / 知识引用 / human review 门禁"这条产品线确认真实存在于代码中，且有可运行的确定性测试），但**具体类型名与用户列表不完全一致**，可能是命名在项目后期演进过、用户记忆的是更早或更晚版本的命名，或是不同模块的相似概念。不应把用户列表当作逐字精确的源代码事实。

## 3. 已完成模块 / 已验收 Gate

依据 commit message 判断（governance/closure/acceptance 相关，共 14 处 "governance"、1 处 "acceptance"），本次会话内确认**真实存在**且时间上最接近删除事故（19:49）的收尾工作是：

- tenancy 数据完整性验收（`8cdedb60…` "close tenancy data integrity acceptance"）
- 组织去重处置门禁（`d057899…`）
- 组织创建幂等性契约（`78c2184…`）
- 身份回调验证（`f90e480…`）
- 账号入驻工作区收尾（`3e1f796…`）

这批**与用户描述的"内容/文章/知识"领域无关**，属于 tenancy/auth/组织管理条线。两条线索（tenancy 条线 vs 内容条线）在本次恢复到的证据中**都真实存在**，但删除前最后一批 commit 属于 tenancy 条线，不是内容条线。

## 4. 已知数据库备份

| 声明路径 | 验证结果 |
|---|---|
| `D:\Documents\geo-reference-data\backups\geo-control-plane\kir-01-closed\2026-07-11\` | **路径不存在**。已确认 `D:\Documents` 下没有任何名为 `geo-reference-data` 的目录（含大小写/近似名检索）。 |
| `D:\Documents\geo-reference-data\backups\geo-control-plane\kwr-01-ws1-pre-migration\2026-07-12\` | 同上，**路径不存在** |
| `D:\Documents\geo-reference-data\backups\geo-control-plane\kwr-01-ws3a-pre-migration\2026-07-12\` | 同上，**路径不存在** |

`geo-control-plane-kir-01-closed.dump` / `geo-control-plane-kir-01-closed-schema.sql` / `backup-manifest.json`：在当前**稳定证据范围**（`F:\GEO_CONTROL_PLANE_CHECKPOINT`）内**未搜到**（本轮未对仍在增长的 `F:\TestDisk_Recovery` 做全量扫描，按指示留待 TestDisk 完成后做增量检索）。

**这是本次评估中最大的一处未闭合缺口**：既不能确认这些备份从未存在，也不能确认它们已被找回。

## 5. 已知测试和运行报告

确认存在的真实、内容完整的测试代码（非猜测）：
- vitest 测试：`buildArticleBriefOfflineV1` 相关 describe/it/expect 块，覆盖 human-review 映射、风险升级、非法家族拒绝、确定性/不可变性
- 测试脚本运行输出结构：`{status, briefs, provider_calls, database_writes, fabricated_defaults}`（表明项目有"零外部调用、零数据库写入"的确定性回归测试设计）

## 6. 已知文件名 / 类型名 / 接口名 / 文档标题

见 `TODAY_NODE_RECOVERY_MATRIX.md` 第 1、2 节的精确清单，不在此重复。

## 7. 尚未启动或明确禁止启动的模块

用户未在本轮提供具体清单，本次会话未发现可独立佐证的证据，此项**留空，不臆测**。

---

## 附录 A（第二轮修正）：项目身份说明

用户指出：geo-control-plane 是 "GEO Article Production Control Plane"（知识驱动文章生产与交付系统），不是中央多租户 SaaS；tenancy/组织入驻/身份认证等最近提交，属于同一控制平面的**横切治理与访问控制层**，不是另一个项目。

**本次会话核实情况**：这一说明本身未在恢复证据中被逐字确认（未找到写明"GEO Article Production Control Plane"字样的文档），但与本轮新发现的证据**不矛盾、且方向一致**：
- 恢复出真实路由 `redirect("/app/projects/example-enterprise/knowledge")` —— 应用确实有 "项目 → 知识" 路由结构
- 恢复出真实模块 `@/components/control-plane/pages` 的 `VisibilityPage` —— 确认 "control-plane" 是代码中真实使用的模块命名空间
- 恢复出完整的 "OPR-01B Candidate 2 Provider Assisted Article Revision" 证据封存文档，含 execution_id、封存 commit（`fe8f7f9cd912d2c17dd454775768f1c3cd8e4833`，已确认为有效 commit，message: "chore(evidence): seal candidate2 article revision r2"）、失败码（`ACTUAL_TOKEN_LIMIT_EXCEEDED`、`PROVIDER_DRAFT_CONTRACT_INVALID`）、审批状态（`AUTHORIZED_FINAL_CALL`、`READY_AFTER_HUMAN_APPROVAL / PENDING`）—— 这是文章生产主链**确实存在且投入使用**的直接证据，不是猜测。

**结论**：采纳用户的项目身份说明作为工作假设，本次会话不再将 tenancy/auth 相关提交解读为"另一个项目"，而是同一控制平面的治理层；文章生产主链（article-brief / OPR-01B 证据封存）与治理层（tenancy/auth）**两者在恢复证据中都真实存在**，删除前最后一批 commit 落在治理层，不代表文章生产主链代码已经丢失——只代表"最近改动的是治理层"，其余模块的存续状态仍需更多证据判定（见 `TODAY_NODE_RECOVERY_MATRIX.md`）。

## 附录 B：新增目标 SHA 核实结果

| SHA | 结果 |
|---|---|
| `e12f06ddddf04ad3ca06b88012baeae075e68082` | 未找到 |
| `87a0597ee92446a6345e2cb53e5c826b8940a1ec` | 未找到 |
| `2c792c68cae4737884098b6be3a4bcfe28a84de4` | 未找到 |

三者均未出现在已恢复的 117 个 commit、worktree 元数据（HEAD/ORIG_HEAD/logs/COMMIT_EDITMSG）中。按用户指示：**不判定为"不存在"，仅记录为"当前未找到，待后续扫描"**。

## 附录 C：本轮新发现的有效 commit（非用户提供，会话内独立找到）

`fe8f7f9cd912d2c17dd454775768f1c3cd8e4833` —— commit 有效，message: `chore(evidence): seal candidate2 article revision r2`，author time `1784186677`，parent `ecbc7457d7d5de4cae1996c83a1738e67fa3045b`。来源：从一份已恢复的 `offline-two-stage-source-audit-v1` 证据 JSON 中的 `sealed_commit` 字段直接引用，属于强证据（项目自身的证据封存记录点名了这个 commit）。

## 附录 D：geo-reference-data 路径重新定性

用户说明：该路径有历史关闭资料支持。本次会话**未能独立验证"历史关闭资料"的具体内容**（未发现该资料本体），但采纳更贴合现有证据模式的假设：**该目录很可能与 geo-control-plane 主项目一起被同一次递归删除扫过，而非路径记录错误**——这与本次已确认的删除模式一致（`.runtime\postgres\data`、6 个 `geo-control-plane-*` 兄弟 worktree 均在同一事件窗口内被清空）。是否属实，仍需等 TestDisk/PhotoRec 后续结果或人工确认，本轮不下定论。
