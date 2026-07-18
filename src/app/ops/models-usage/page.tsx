/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): 模型与用量 (models & usage) — no read endpoint exists
 * yet for model usage. Per this batch's scope, this surface shows a clean placeholder EMPTY state
 * and fabricates NO data (the earlier fixture usage list has been removed). When a real read
 * endpoint lands, wire it here with the five async states; any model identity it renders must stay
 * genericized (no real AI/model provider or vendor name), per the standing compliance rule.
 */
export default function OpsModelsUsagePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>模型与用量</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无用量数据 — 模型用量读取接口尚未提供，接入后将在此展示真实用量汇总。
      </p>
    </>
  );
}
