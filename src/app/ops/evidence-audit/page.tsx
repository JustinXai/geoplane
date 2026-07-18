/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): Evidence 审计 (evidence audit) — no read endpoint
 * exists yet for evidence audit. Per this batch's scope, this surface shows a clean placeholder
 * EMPTY state and fabricates NO data (the earlier fixture list has been removed). When a real read
 * endpoint lands, wire it here with the five async states.
 */
export default function OpsEvidenceAuditPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>Evidence 审计</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无证据审计记录 — 证据审计读取接口尚未提供，接入后将在此展示真实记录。
      </p>
    </>
  );
}
