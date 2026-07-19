/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 客户报告. This post-delivery
 * module has no read endpoint in batch 1 and monitoring is explicitly out of scope, so the page
 * holds a single no-data EMPTY state. No fixtures, no monitoring is built here.
 */
export default function PerformanceValidationPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>客户报告</h1>
          <span>完成内容交付与国内 AI 检测后，这里会显示可核验的结果报告。</span>
        </div>
      </header>
      <p className="cp-list-row cp-list-empty" role="status">
        暂无客户报告。请先完成内容交付和国内 AI 检测，系统不会生成模拟结果。
      </p>
    </>
  );
}
