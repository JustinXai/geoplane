# 界面真实性回归检查 V2

本检查只提供可复跑的验收机制，不声明当前产品已经通过人工验收，也不把“接口存在”视为“用户能力可用”。

## 输入证据

集成阶段把浏览器实际渲染出的可见文本写入 `rendered/*.txt`，把平台管理员读取到的账号安全投影写入 `accounts/*.json`，并在 `capabilities.json` 中逐项分别记录：

- `apiWiring`：前端动作是否已有真实 HTTP 接线；
- `usableCapability`：用户是否能完成操作、得到可理解反馈，并在刷新或重新登录后继续读取；
- `evidence`：支持“可用”判断的浏览器或 HTTP 证据编号。

两个数量由扫描器独立统计，禁止用 API 数量替代可用能力数量。

## 执行

```text
npm run acceptance:ui-truth -- E:\GEO_REBUILD_WORKSPACE\outputs\p0-v2\final-acceptance
```

扫描器核验正式渲染文本不出现测试数据标识，客户导航不出现“内容与信源”，系统名称和“国内 AI 检测”术语一致，主工作台不存在大面积能力占位，并递归检查账号响应中是否包含秘密字段。

最终运行 SHA、构建 SHA、Bundle SHA 和动态页面数量必须由集成负责人基于最终构建重新采集；本分支不能提前给出 READY 判定。
