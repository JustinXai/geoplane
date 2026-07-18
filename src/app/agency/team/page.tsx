/**
 * PRODUCT_RUNTIME_CLOSURE_V1: 团队与权限 (team & permissions) — no read endpoint exists yet for
 * agency team membership/roles. Per this phase's scope (fixture-backed formal page count = 0),
 * this surface shows a clean placeholder EMPTY state and fabricates NO data (the earlier
 * _fixtures AGENCY_TEAM_MEMBERS list has been removed). The persistent acting-for-client banner
 * is rendered once by the shared agency layout. When a real read endpoint lands, wire it here
 * with the five async states like the agency client list.
 */
export default function AgencyTeamPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>团队与权限</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无团队成员数据 — 团队与权限读取接口尚未提供，接入后将在此展示真实成员与角色。
      </p>
    </>
  );
}
