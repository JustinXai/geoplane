# Taste 设计规则应用说明

## 核验结论

`TASTE_SKILL_NOT_FOUND`

在开始界面修改前，已只读检查以下范围内全部 `SKILL.md`，并按 `taste`、`ui`、`design`、`frontend`、`visual` 搜索文件名及内容：

- 项目内 `.claude/skills/**/SKILL.md`
- 项目内 `.agents/skills/**/SKILL.md`
- `%USERPROFILE%/.claude/skills/**/SKILL.md`
- `%USERPROFILE%/.agents/skills/**/SKILL.md`
- 本机 Codex 技能目录 `C:/Users/Administrator/.codex/skills/**/SKILL.md`
- 本机 Codex 数据与插件目录 `D:/CodexData/.codex/skills/**/SKILL.md`、`D:/CodexData/.codex/plugins/**/SKILL.md`

未找到名为 Taste、或内容可确认是 Taste/UI 视觉设计规范的真实 Skill。因此本阶段没有引用、转述或假设任何 Taste Skill 内部内容。

## 本阶段采用的规则来源

以下规则均来自已冻结的产品任务，不宣称来自 Skill：

1. 国内企业级 SaaS：浅色中性底、白色内容面、稳定边框与清晰信息层级。
2. 桌面端优先：固定侧栏、顶部上下文栏，表格、任务列表、进度与状态标签优先。
3. 克制可信：单一主色、统一状态色、少阴影、适度圆角，不使用霓虹、玻璃拟态和装饰性动画。
4. 中文可读：中文系统字体优先；正式界面不泄漏内部枚举、哈希、Schema、Provider 等工程术语。
5. 真实反馈：统一加载、空、错误、无权限和成功反馈；没有后端能力时明确说明尚未开放。
6. 真实数据：指标与列表只来自已授权的真实 Read Model；禁止 Fixture、假数字和无后端动作的按钮。

## 落地位置

- 全局颜色、字体、间距、边框、圆角、阴影及状态色：`src/app/globals.css`
- 页面标题、指标、区块、状态、空错加载与进度组件：`src/components/ui/index.tsx`
- 固定侧栏与顶部上下文结构：`src/components/layout/WorkspaceShell.tsx`
- 中文状态与操作词典：`src/lib/i18n/zh-CN.ts`

