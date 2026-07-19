# P0 国内 GEO 能力恢复报告

阶段：`P0_DOMESTIC_GEO_PARALLEL_CAPABILITY_RESTORATION_V1`

## 基线与集成

| 项目 | 结果 |
|---|---|
| Starting Safe SHA | `baf550d3fc17589de2b474706560107763176cf1` |
| Recovery Governance SHA | `9735bc4f71d103a0d700f927803befd8e268e293` |
| Current Integration Gate SHA | `6a6891e`（本报告提交前的代码与终审 Gate） |
| 集成分支 | `local/domestic-geo-p0-v1` |
| main | `cfb230f1565600ae95c2fd1b78ee92086b498095`，未修改 |

## 六条 P0 能力线

| 能力 | 状态 | 交付边界 |
|---|---|---|
| Account Center Status | `P0_RUNTIME_RECOVERED` | 16 个国内平台定义；三种所有权；授权、分配、健康、用量、操作任务与结果；严格 `secretref://` 引用；不保存或返回秘密 |
| Baidu Keyword Runtime Status | `P0_RUNTIME_RECOVERED` | CSV/XLSX 导入、原始证据、Hash、规范化、同词多 Seed、需求快照及人工审核；未导入历史资产 |
| AI Expansion Status | `P0_RUNTIME_RECOVERED_FROM_FROZEN_SPEC` | 分类仍为 `RECOVERED_SPECIFIED_NOT_COMPLETED`；Deterministic Offline Adapter；默认 `NEEDS_HUMAN_REVIEW` |
| China AI Probe Status | `P0_MANUAL_RUNTIME_RECOVERED` | 豆包、通义千问、DeepSeek、腾讯元宝；只允许 `MANUAL_SAMPLE`；原始结果只追加 |
| Vertical Pack Status | `P0_RUNTIME_RECOVERED` | `GENERIC_GEO_V1` 与最小 `MEDICAL_AESTHETICS_V1`；Core 跨行业；未知 Pack 失败关闭；最终仍需人工审核 |
| Agency Delivery Status | `P0_RUNTIME_RECOVERED` | 13 阶段工作流、6 类 Read Model、真实 PostgreSQL 组合、人工交付回执、项目/客户三层范围校验 |
| Source Collection Status | `DEFERRED_SEPARATE_SYSTEM` | 未创建采集 Migration、爬虫、Atlas、评分或自动 Citation Analysis |

## 数据与测试计数

| 指标 | 结果 |
|---|---:|
| Migration Range | `0010–0017`；0016/0017 为不可变 Migration 的前向加固 |
| Account Platform Count | 16（AI 4，内容平台 12） |
| Keyword Import Test Rows | 4 条有效脱敏行（CSV 2、XLSX 2），另验证 2 条拒绝行 |
| AI Expanded Keyword Test Rows | 2 条确定性候选 |
| China AI Platform Registry Count | 6（ACTIVE 4，RESERVED 2） |
| Manual Probe Test Runs | 2（回答 1、失败 1） |
| Vertical Pack Count | 2 |
| Agency Read Model Count | 6 |
| Focused Tests | 58 项 Lane 核心断言通过；另有集成与 PG 加固测试 |
| Full Tests | 1019 PASS；5 个安全/环境条件跳过 |

## 不变量与边界

| Gate | 结果 |
|---|---|
| Tenant Isolation | PASS；Client 不跨客户，Agency 只读取有效授权客户 |
| Account Ownership Isolation | PASS；客户账号不跨客户，平台账号须经项目分配，操作员须有有效成员资格 |
| Publication Receipt Scope | PASS；任务、账号分配、回执必须同账号、同客户、同项目 |
| Observed Demand Integrity | PASS；`OBSERVED_DEMAND` 只来自带需求事实的导入证据 |
| AI Demand Fabrication Count | 0 |
| Probe Raw Result Append-only | PASS |
| Agency Workflow / Delivery History Append-only | PASS |
| Automatic Approval | NO |
| Automatic Publication | NO |
| Default Selected Channel Count | 0 |
| Real Provider Calls | 0 |
| Real Customer Data | 0 |
| Remote Write Attempts | 0（本阶段可观察执行记录） |

## 最终 Gate

| Gate | 结果 |
|---|---|
| Migration Apply | PASS；独立 `geoplane_p0_integration_test` 从空库应用 0001–0017 |
| Real PostgreSQL Agency Scope Gate | PASS；两个均获授权客户之间的项目/客户错配被服务和 DB 拒绝 |
| Typecheck | PASS |
| Next Build | PASS |
| Security Scan | PASS |
| Repo Safety | PASS；Local Only、无 upstream |
| Supervisor Decision | `PASS` |
| Bundle Path | `E:\GEO_REBUILD_BACKUPS\geoplane\domestic-geo-p0-final.bundle` |

全量测试的 5 个跳过来自明确的安全/环境条件：保留既存 `geoplane_local_restore_verify` 恢复证据，以及最终测试进程未注入 Runtime/Canary 等非本阶段数据库角色。没有删除或覆盖该恢复证据，也没有为了测试通过而迁移 Runtime 数据库。

## 开放项

- 最终 UI、Taste Skill 和大规模页面恢复不在本轮；
- 自动账号登录、自动 Probe、自动发布继续关闭；
- 自动信源采集作为未来独立系统；
- Runtime/Canary 数据库升级由后续明确的本地运维步骤执行，本轮只验证独立 P0 测试库；
- `middleware` 到 `proxy` 的 Next.js 弃用提示不阻塞本轮能力恢复。

## 决策

`P0_DOMESTIC_GEO_RUNTIME_RECOVERED`

Exact Next Single Action：

`START DOMESTIC GEO WORKSPACE UI RESTORATION FROM RECOVERED RUNTIME`
