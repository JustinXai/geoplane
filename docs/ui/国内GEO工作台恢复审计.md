# 国内 GEO 工作台恢复审计

## 审计结论

**REJECT_AND_REPLAN**

审计对象：`local/domestic-geo-workspaces-v1@72c08f9f0d483055144e34df53ec36efd0f8cbcc`

本提交已经建立中文三角色路由、浅色企业级视觉基础和一批真实读取/写入接线，但尚未达到“完整中文三角色工作台可供人工验收”的门槛。核心阻断是：真实登录页未接线、账号能力未覆盖代理商和客户、人工查询成品组件未进入正式页面、行业规则包仅显示缺口、客户确认与代理商业务动作多处仍为只读或未开放。

## 核验摘要

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| Taste 实查 | 通过 | `docs/ui/Taste设计规则应用说明.md` 明确记录 `TASTE_SKILL_NOT_FOUND`，未伪造 Skill 原则 |
| 恢复证据分类 | 部分通过 | 记录 7 份可读片段及 3 份 NUL 文件，但仍混用旧标签 `FROZEN_SPEC`、`CURRENT_RUNTIME`、`NEW_PRESENTATION_ONLY`，与本阶段四类标签不完全一致 |
| 冻结业务结构 | 部分通过 | 三角色导航大体形成；部分名称不符冻结结构，如代理商仍显示“代理商总览”“授权客户”“人工探测” |
| Fixture 正式页面 | 通过（静态导入） | 正式页面未导入 `_fixtures`；但三个 `_fixtures.ts` 及旧 fixture 组件仍留在正式源码树，建议清理以避免回归 |
| 假数据/假指标 | 通过 | 已展示指标来自读取模型，缺少能力时显示“尚未开放”，未发现硬编码业务数字进入正式页面 |
| Secret 泄漏 | 通过（静态） | 账号响应剥离 `secretReference`，页面未显示密码、Cookie、Token 或 Key |
| 正式英文/内部术语 | 不通过 | `src/app/login/page.tsx` 显示 `rebuild/tenancy-auth`；`src/app/agency/manual-probe/page.tsx` 显示 `Provider`；若挂载人工查询组件还会显示 `BACKEND_CAPABILITY_GAP` |
| 假按钮 | 通过（已检查页面） | 可见按钮均有提交处理或明确禁用；无能力页面没有伪造成功按钮 |
| 写入持久化 | 部分通过 | 组织/项目、账号登记、百度导入、拓词审核、知识上传、内容确认存在真实 API；但未完成浏览器刷新/重登验证，人工查询 UI 不可达 |
| 路由与租户隔离 | 静态通过、浏览器未验 | `src/middleware.ts` 对 `/app`、`/agency`、`/ops` 做角色面隔离；API Read Model 按客户/代理授权过滤 |
| 自动批准/自动发布 | 通过（静态） | 页面没有自动批准或自动发布动作；交付页面明确人工操作 |
| 来源采集边界 | 通过 | 未新增爬虫、自动采集或自动引证页面，页面明确该能力属于独立系统 |
| Migration | 通过 | 仍为 `0001–0017`，相对 P0 基线未见新增迁移 |

## P0 必修项

1. 将真实登录表单接入 `POST /api/auth/login`，按服务端角色落到 `/ops`、`/agency` 或 `/app`；删除占位文案。文件：`src/app/login/page.tsx`。
2. 将 `ManualProbeWorkspace` 或等价真实组件接入正式角色页面，并由 `/api/probes/options` 提供项目与已确认问题。文件：`src/app/ops/probes/page.tsx`、`src/app/agency/manual-probe/page.tsx`、`src/app/app/ai-results/page.tsx`、`src/components/probe-report/ManualProbeWorkspace.tsx`。
3. 为平台正式提供项目行业 Pack 读取视图，不能在已有安全读取路由时仍显示“尚未提供”。文件：`src/app/ops/rule-packs/page.tsx`、`src/app/api/policy-packs/projects/[projectId]/route.ts`。
4. 完成代理商和客户账号页面：读取真实账号、所有权分区、授权/撤销边界、项目分配、健康、任务和记录；当前两页均为空状态。文件：`src/app/agency/accounts/page.tsx`、`src/app/app/accounts/page.tsx`。
5. 完成客户拓词人工确认/删除、用户问题确认和内容审核的冻结业务动作；当前关键词和问题页明确写着“尚未开放”。文件：`src/app/app/keywords/page.tsx`、`src/app/app/questions/page.tsx`。
6. 完成三角色 HTTP 与浏览器验收，证明登录、刷新、重登、跨角色拒绝、未分配客户拒绝及写入连续性。当前静态测试不能替代该 Gate。

## P1 修正项

- 统一导航名称到冻结文案，移除不在冻结结构内的正式入口或将其并入对应页面。
- 清理 `src/app/app/_fixtures.ts`、`src/app/agency/_fixtures.ts`、`src/app/ops/_fixtures.ts` 及旧 `src/components/agency/agency-acting-banner.tsx`。
- 修正文档矩阵中“页面已具备动作”的超前声明；当前实现与 `docs/ui/国内GEO页面完整矩阵.md` 多处不一致。
- 把正式页内的 `Provider`、`rebuild/tenancy-auth`、`BACKEND_CAPABILITY_GAP` 替换为用户可理解的中文业务文案。

## 验证记录

- `npm run typecheck`：PASS
- 定向测试：19 个文件通过、1 个跳过；53 项通过、2 项跳过
- 本报告未修改集成工作树，未执行任何远程操作。
