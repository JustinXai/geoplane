/**
 * PRODUCT_RUNTIME_CLOSURE_V1: 品牌白标 (white-label branding) — an explicitly lower-priority
 * surface with no real branding controls (logo/theme upload, custom domain) built this phase.
 * Kept as a clean placeholder that imports NO fixtures and renders NO fabricated data. The
 * persistent acting-for-client banner is rendered once by the shared agency layout.
 */
export default function AgencyBrandingPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>品牌白标</h1>
          <span>占位页面 — 品牌白标为冻结规格中明确的低优先级功能，本阶段暂不展开具体内容。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        品牌白标为低优先级功能，尚未开发；此页面不展示任何模拟数据。
      </p>
    </>
  );
}
