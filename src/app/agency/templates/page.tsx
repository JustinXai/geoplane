/**
 * PRODUCT_RUNTIME_CLOSURE_V1: 行业模板 (industry templates) — no read endpoint exists yet for
 * agency industry templates. Per this phase's scope (fixture-backed formal page count = 0),
 * this surface shows a clean placeholder EMPTY state and fabricates NO data (the earlier
 * _fixtures INDUSTRY_TEMPLATES list has been removed). The persistent acting-for-client banner
 * is rendered once by the shared agency layout. When a real read endpoint lands, wire it here
 * with the five async states like the agency client list.
 */
export default function AgencyIndustryTemplatesPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>行业模板</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无行业模板数据 — 行业模板读取接口尚未提供，接入后将在此展示真实模板库。
      </p>
    </>
  );
}
