/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): 发布连接器 (publisher connectors) — no read endpoint
 * exists yet for publisher connectors. Per this batch's scope, this surface shows a clean
 * placeholder EMPTY state and fabricates NO data (the earlier fixture list has been removed).
 *
 * The Publication principles remain in force: external publisher integrations (e.g. a WeChatSync-
 * style bridge) are future, opt-in, explicit — never a default/auto-enabled path. The empty state
 * therefore reflects 0 connectors enabled/connected, and no connector may be shown as
 * enabled-by-default. When a real read endpoint lands, wire it here with the five async states.
 */
export default function OpsPublisherConnectorsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>发布连接器</h1>
          <span>该功能尚无可用的读取接口。此页面为占位状态，不展示任何模拟数据。当前已启用连接器数量：0。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无已启用的发布连接器 — 发布连接器为面向未来的可选集成，需运营方在授权后显式接入，绝不作为默认启用或自动发布路径。
      </p>
    </>
  );
}
