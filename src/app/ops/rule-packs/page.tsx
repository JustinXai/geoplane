/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): 规则包 (rule packs) — no read endpoint exists yet for
 * rule packs. Per this batch's scope, this surface shows a clean placeholder EMPTY state and
 * fabricates NO data (the earlier fixture list has been removed). When a real read endpoint lands,
 * wire it here with the five async states.
 */
export default function OpsRulePacksPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>规则包</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无规则包数据 — 规则包读取接口尚未提供，接入后将在此展示真实的核心规则包与垂直规则包。
      </p>
    </>
  );
}
