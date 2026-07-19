# 国内 GEO 页面完整矩阵

证据分类只使用：`RECOVERED_EXACT`、`RECOVERED_PARTIAL`、`FROZEN_BUSINESS_STRUCTURE`、`REBUILT_PRESENTATION`。真实运行时接线另列，不把新页面写成原界面。

## 客户工作台（8 个固定导航页面）

| 页面 | 分类 | 当前真实状态 |
| --- | --- | --- |
| 项目总览 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 真实项目、关键词、问题、内容与交付聚合 |
| 企业资料 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 真实资料上传、知识包确认与缺口读取 |
| 账号授权 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 安全账号列表、客户自有账号登记与确认授权；撤销命令缺失 |
| 关键词确认 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 百度导入/概览、离线拓词预览与逐条确认/删除；百度出价、竞争度、地域缺失 |
| 用户问题确认 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 真实问题读取；缺少稳定审核标识，确认动作未开放 |
| 内容审核 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 内容方向人工确认可写；客户文章草稿读取/修改请求缺失 |
| AI 查询结果 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 四个国内平台人工样本真实读写；账号关联和品牌/竞品标注缺失 |
| 交付与报告 | `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION` | 真实交付与回执读取；不伪造效果指标 |

## 代理商工作台（15 个固定导航页面）

总览、授权客户、客户项目、待办、账号、企业知识、百度关键词、AI 拓词、用户问题、内容、审核、国内 AI 查询、交付、报告、团队均为 `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION`。其中客户/项目/待办/账号安全投影/百度导入与概览/离线拓词/问题/审核/人工查询/交付进度和人工交付动作已接真实运行时。知识列表、内容任务列表、报告和团队若无安全读取能力，显示正式中文能力缺口。代理商范围由服务端有效分配过滤，代客户操作持续显示提示。

## 平台运营工作台（14 个固定导航页面）

运营总览、代理商、客户、项目、账号、关键词、AI 拓词、内容审核、国内 AI 查询、交付报告、行业规则包、邀请权限、审计、系统健康均为 `FROZEN_BUSINESS_STRUCTURE` + `REBUILT_PRESENTATION`。组织/项目/审计/健康、创建组织与项目、16 平台账号登记与安全列表、按项目百度导入/离线拓词、人工查询、当前行业 Pack 已接真实运行时。无平台级安全聚合的页面显示正式中文能力缺口。

## 明确不在范围

来源自动采集为 `DEFERRED_SEPARATE_SYSTEM`。不开发爬虫、自动引证、真实 Provider、自动登录、自动批准、自动发布、效果监测或计费。
