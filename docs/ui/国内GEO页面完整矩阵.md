# 国内 GEO 页面完整矩阵

判定说明：`RECOVERED_EXACT` 表示有可读恢复片段；`FROZEN_SPEC` 表示来自冻结产品结构；`CURRENT_RUNTIME` 表示当前后端已存在；`NEW_PRESENTATION_ONLY` 表示仅重做展示，不改变业务规则。

## 客户工作台

| 页面 | 来源 | P0 | 正式行为 |
| --- | --- | --- | --- |
| 项目总览 | `FROZEN_SPEC` | 是 | 只展示真实项目与业务进度；无指标则给出真实空状态 |
| 企业知识库 | `FROZEN_SPEC` | 是 | 资料上传、列表、缺口与画像调用现有能力 |
| 百度关键词 | `FROZEN_SPEC` | 是 | 导入、查询与排序接现有关键词能力 |
| AI 拓词 | `FROZEN_SPEC` | 是 | 仅使用现有拓词工作流，不调用真实 Provider |
| 用户问题 | `FROZEN_SPEC` | 是 | 问题列表、状态与确认动作真实落库 |
| GEO 内容 | `FROZEN_SPEC` | 是 | 任务、生成状态与正文使用真实数据 |
| 内容审核 | `FROZEN_SPEC` | 是 | 批准、退回、修改意见调用现有审核能力 |
| 人工探测 | `FROZEN_SPEC` | 是 | 只显示人工执行与真实结果，不做自动采集 |
| GEO 报告 | `FROZEN_SPEC` | 是 | 报告只由真实探测结果聚合，不伪造效果数据 |
| 交付中心 | `FROZEN_SPEC` | 是 | 发布回执与交付状态调用现有能力；自动发布关闭 |
| 设置 | `FROZEN_SPEC` | 部分 | 仅开放已有且有授权的项目设置 |

## 代理商工作台

| 页面 | 来源 | 正式行为 |
| --- | --- | --- |
| 总览 | `FROZEN_SPEC` | 授权范围内真实客户、项目与待办聚合 |
| 授权客户 | `RECOVERED_PARTIAL` + `CURRENT_RUNTIME` | 搜索、筛选、只读/代操作上下文；只见已授权客户 |
| 客户项目 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 真实项目列表与当前客户上下文 |
| 待办 | `FROZEN_SPEC` | 从资料、问题、审核、交付状态聚合真实待办 |
| 账号 | `FROZEN_SPEC` | 只开放已有账号能力 |
| 知识库 | `FROZEN_SPEC` | 代客户查看或操作，持续显示代操作提示 |
| 百度关键词 | `FROZEN_SPEC` | 代客户操作真实关键词能力 |
| AI 拓词 | `FROZEN_SPEC` | 不调用真实 Provider |
| 用户问题 | `FROZEN_SPEC` | 真实确认进度与动作 |
| 内容 | `FROZEN_SPEC` | 真实内容状态 |
| 审核 | `FROZEN_SPEC` | 真实审核动作 |
| 人工探测 | `FROZEN_SPEC` | 仅人工结果，不做来源采集 |
| 交付 | `FROZEN_SPEC` | 真实交付与回执 |
| 报告 | `FROZEN_SPEC` | 仅真实结果报告 |
| 团队 | `FROZEN_SPEC` | 无安全能力时显示尚未开放 |

## 平台运营工作台

| 页面 | 来源 | 正式行为 |
| --- | --- | --- |
| 运营总览 | `FROZEN_SPEC` | 从真实组织、项目、邀请、审核、执行与健康数据聚合 |
| 组织管理 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 创建和查看组织 |
| 代理商管理 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 创建代理商、管理授权范围 |
| 客户管理 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 创建客户与项目 |
| 项目管理 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 查看与创建项目 |
| 客户分配 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 代理商与客户授权分配 |
| 邀请与账号 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 邀请、撤销与账号状态 |
| 业务审核 | `FROZEN_SPEC` | 人工审核；自动批准保持关闭 |
| 执行记录 | `FROZEN_SPEC` | 真实任务执行状态，不显示内部执行标识 |
| 审计中心 | `RECOVERED_EXACT` + `CURRENT_RUNTIME` | 中文化真实账户与业务审计 |
| 模型与用量 | `FROZEN_SPEC` | 无安全 Read Model 时显示尚未开放 |
| 规则包 | `FROZEN_SPEC` | 只接现有规则包能力 |
| 发布连接器 | `FROZEN_SPEC` | 不显示密钥或完整地址；自动发布关闭 |
| 系统健康 | `FROZEN_SPEC` | 真实健康状态；Provider 显示已关闭 |

所有新增布局和视觉组件均为 `NEW_PRESENTATION_ONLY`。效果监测、来源自动采集、真实 Provider、自动发布和计费不在本阶段范围内。

