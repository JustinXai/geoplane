# TODAY_NODE_RECOVERY_MATRIX（第二版，含修正）

生成时间：2026-07-17（会话内）。TestDisk 全程后台运行未被中断/重启。本文件基于两轮证据整理：第一轮（`git-object-database`/`worktree-metadata`/`recovered-orphan-source-files` 首次快照）+ 第二轮（新增 SHA/关键词/内容签名检索）。
证据边界：不再检查 `.next`/webpack 缓存（已结束该方向）；未对仍在增长的 `F:\TestDisk_Recovery` 做重复全量统计，仅做定向内容检索；一项定向检索（opr-r7-recovery / provider-envelope-tests worktree 名称扫描）因 TestDisk 占用磁盘 I/O 仍在后台排队中，尚无结果，列入"仍待扫描确认"。

**核心修正**：本版不再使用"零证据，必须重新实现"这类一次性判死刑的表述。Git 根 tree、两个 pack 包、以及尚未扫描完的磁盘区域仍可能包含未发现的证据，"当前未找到"≠"永久丢失"。项目身份采纳用户说明：GEO Article Production Control Plane（知识驱动文章生产与交付系统），tenancy/auth 是该平台的横切治理层，不是另一个项目。

---

## 五档状态分类总览

| 状态 | 定义 |
|---|---|
| **已完整恢复** | 文件名+内容+原始路径三者皆已确认，可直接使用 |
| **已部分恢复** | 内容或文件名至少一项确认，路径或另一项仍缺失，但有实质证据（非猜测） |
| **当前未找到** | 在已搜索的稳定证据范围内没有命中，扫描尚未覆盖全部磁盘，不代表已丢失 |
| **已确认丢失** | 有明确技术证据证明数据已被覆盖/物理不可逆（如 Postgres data/WAL 目录已验证为空壳、原 pack 签名不匹配） |
| **仍待扫描确认** | 本轮已发起但受 TestDisk 磁盘 I/O 占用尚未跑完的检索项 |

---

## 1. 已完整恢复

- `article-brief-offline-v1` 相关：函数 `buildArticleBriefOfflineV1`、路径 `src/opportunity/article-brief-offline-v1.ts`、测试固件 `src/opportunity/fixtures/article-brief-fixtures.redacted.json`、4 条真实 vitest 断言（human-review 映射 / 风险升级 / 非法家族拒绝 / 确定性与不可变性）
- 28 个"文件名+内容"双确认文件（详见附录 A，含 `README.md`、`root-seal.json` 系列证据文档、`revision-draft-canonical-hash.ts` 等）
- OPR-01B Candidate 2 Article Revision 证据封存记录（新增发现）：完整 JSON，含 `execution_id: opr-01b-xingmei-candidate2-article-revision-v2`、`sealed_commit: fe8f7f9cd912d2c17dd454775768f1c3cd8e4833`（**已验证为有效 commit**，message: "chore(evidence): seal candidate2 article revision r2"）、失败码 `ACTUAL_TOKEN_LIMIT_EXCEEDED` / `PROVIDER_DRAFT_CONTRACT_INVALID`、审批状态 `AUTHORIZED_FINAL_CALL` / `READY_AFTER_HUMAN_APPROVAL / PENDING`

## 2. 已部分恢复

- 约 10 个孤立命名源码文件（`page.tsx` ×7、`route.ts` ×5、`shared.tsx`、`invite-accept-client.tsx`）：文件名+部分内容确认，**原始路径丢失**
- 真实路由片段：`redirect("/app/projects/example-enterprise/knowledge")` —— 确认应用有"项目→知识"路由，但不知道这个重定向所在文件的完整路径，也不知道 `/knowledge` 页面本身的实现代码
- 真实模块引用：`import { VisibilityPage } from "@/components/control-plane/pages"` —— 确认 `@/components/control-plane/pages` 模块存在且被引用，但该模块自身实现代码未恢复
- `docs/reviews/candidate-2-provider-assisted-article-revision-v2/` 目录结构：通过证据 JSON 中的路径字段间接确认存在，但目录下的实际文件（`raw-provider-envelope.json`、`failure.json`）内容本身**未恢复**（对应 blob_oid 解压失败）
- tenancy/组织入驻/身份认证条线：15 个 commit message 证据链完整（做了什么、按什么顺序），但根 tree 缺失，具体代码内容未恢复

## 3. 当前未找到（不代表已丢失，含用户第二轮追加的检索目标）

- 新增目标 SHA：`e12f06ddddf04ad3ca06b88012baeae075e68082`、`87a0597ee92446a6345e2cb53e5c826b8940a1ec`、`2c792c68cae4737884098b6be3a4bcfe28a84de4` —— 在 117 个已恢复 commit 及全部 worktree 元数据中均未命中
- `234eb7c1871c716ca4c744d45485608cba1a0099`（用户称 Candidate 3 集成提交）—— 同上未命中；已找到 5 个消息含 "candidate3/candidate 3" 字样的其他 commit（见上一版附录）
- Master Content Hash `8b28a6e3cc811836c607cbfe7c298323c172928d2a5786cecea7338b00630957` —— 未命中；但确认项目**确实使用 sha256 字段记录内容哈希**的模式（在 OPR-01B 证据文档中发现 `sha256_raw_bytes` 字段），说明用户描述的"内容哈希锚点"机制本身是真实存在的设计，只是这个具体哈希值目前没找到对应文件
- 关键词：`opr-r7`、`provider-envelope-tests`（作为 worktree 名）、`response-extraction`、`micro-canary`、`claim-level grounding`、`context-lane`、`KIR_01_CLOSURE_CHECKPOINT`、`ARCHITECTURE.md` —— 在当前已提取的 120 个有效 blob 及 commit message 中均未命中（`provider-envelope` 作为路径片段有 1 处命中，见上）
- 数据库相关：`PGDMP` 文件头、`CREATE TABLE`、`CREATE TYPE`、`pgTable`、`kir-01-closed`、`kwr-01`、`backup-manifest`、`KnowledgeSnapshot`、`KnowledgeIssue`、`ArticleExecutionContext` —— 在当前稳定证据范围内均未命中
- `D:\Documents\geo-reference-data`（及其下三个备份路径）—— 整个目录当前在磁盘上不存在。**修正定性**：不再判断为"路径记录可能有误"，改为"该路径可能与 geo-control-plane 主项目一起被同一次递归删除扫过（与已确认的删除模式一致：`.runtime\postgres\data`、6 个兄弟 worktree 均在同一事件窗口被清空），是否属实待后续磁盘恢复结果确认"

## 4. 已确认丢失（有明确技术证据，非"未找到"）

- Postgres 业务数据与 WAL：`data\base\1`、`pg_wal` 已验证为空目录（0 文件），且 Postgres 自身日志记录了 19:49:47–19:50:32 期间持续报错 "could not open file"，说明底层文件在数据库运行时被主动删除，非"未扫描到"
- 两个 git pack 包（`pack-0502724d…`、`pack-1de1d14b…`）：文件签名不匹配（不是有效的 PACK 格式头），已确认为不可用，不属于"待扫描"范畴
- 全部 117 个已恢复 commit 的根 tree：0/117 有效，已用批量校验方式确认（非抽样）

## 5. 仍待扫描确认

- worktree 名称 `geo-control-plane-opr-r7-recovery`（branch `fix/opr-r7-response-extraction`）、`geo-control-plane-provider-envelope-tests`（branch `test/provider-envelope-compatibility`）：本轮已发起 gitdir 全量检索，因 TestDisk 磁盘 I/O 占用尚未返回结果，**不是"未找到"，是搜索还没跑完**
- `F:\TestDisk_Recovery` 中 TestDisk 完成后新增的部分：按用户指示，此次不做全量重复统计，留待扫描完成后做增量分析
- `geo-reference-data` 三个备份文件（`.dump`/`.sql`/`backup-manifest.json`）在全盘范围内的内容签名匹配：本轮仅搜索了当前稳定的 CHECKPOINT 子集，未搜索仍在增长的 TestDisk_Recovery 全量区域

---

## 距离可编译骨架 / 从零开发的判断（保持第一版结论，未被本轮证据推翻）

- 仍然没有 `package.json`、没有任何一个 commit 的完整文件清单、没有基础工程配置文件的确认证据 —— **当前仍不能机械化建立可编译仓库**
- 但本轮证据显著提高了"文章生产主链存在且已投入实际使用"的置信度（OPR-01B 完整审批/失败/封存工作流），不支持"知识/文章模块零证据"这一表述，已在本版中改写

**结论档位维持：C. 可重建核心能力，但需重新实现部分模块**，但档位内部构成发生变化：
- 文章生产主链（article-brief + OPR-01B 证据封存体系）证据强度从"部分"上调为"较强"，重建成本低于第一版评估
- 知识域具体类型系统（KnowledgeDocument 等）、数据库 schema、`geo-reference-data` 备份仍是"当前未找到"，不是"已确认丢失"，最终能否免于重新实现取决于 TestDisk 扫描完成后的结果，本轮不能给出最终判断

---

## 附录 A：28 个已完整恢复文件清单（延续自第一版，未变化）

```
README.md, checklist.md, publication-checklist.md, index.ts, layout.tsx, page.tsx, route.ts,
fixture-helper.ts, development-seed.ts, revision-draft-canonical-hash.ts, revision-draft-source.json,
root-seal.json, seo-metadata.json, preflight.json, attempt.json, failure.json, ai-usage-event.json,
01-article-brief-planning-context.json, 01-source-audit.json, 03-stage-1-audit.json,
04-human-review-decision.json, 08-article-brief-planning-context.json, 08-publish-readiness.json,
publish-readiness-approved.json, candidate-2-article-decision.template.json,
candidate-2-old-draft-replay.json, candidate-2-revised.approval-input.json,
opportunity-family-fixtures.redacted.json
```
