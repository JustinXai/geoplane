/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): 执行记录 (execution records) — no read endpoint exists
 * yet for platform execution records. Per this batch's scope, this surface shows a clean placeholder
 * EMPTY state and fabricates NO data (the earlier fixture record list has been removed). When a real
 * read endpoint lands, wire it here with the five async states.
 */
export default function OpsExecutionsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>执行记录</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无执行记录 — 执行记录读取接口尚未提供，接入后将在此展示真实记录。
      </p>
    </>
  );
}
