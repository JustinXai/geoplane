/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Publication principles
 *   (frozen, non-negotiable)": "Platform-neutral: no default to the client's own website,
 *   no default to any specific large platform.", "No automatic publication, ever.",
 *   "WeChatSync-style integrations are external Publisher Bridges for the future - not the
 *   primary mechanism, not enabled by default."), docs/governance/SYSTEM_INVARIANTS_V1.md
 *   ("Publication": "External publisher integrations (e.g. a WeChatSync-style bridge) are
 *   future, opt-in, explicit - never wired in as a default path.")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 发布连接器 (publisher connectors). IMPORTANT: per the Publication
 * principles cited above, this page must show 0 connectors enabled/connected by default -
 * every fixture entry (src/app/ops/_fixtures.ts PUBLISHER_CONNECTORS) has
 * enabled: false and connectedCount: 0, and the type itself pins those literal types so a
 * future edit cannot silently flip a connector to enabled-by-default without a type error.
 * Connectors are framed as opt-in future integrations (e.g. a WeChatSync-style bridge),
 * never a default/auto-enabled state. See tests/ops-workspace-copy.test.ts for the
 * compliance check against this rule.
 */
import { PUBLISHER_CONNECTORS, PUBLISHER_CONNECTORS_NOTICE } from "../_fixtures";

export default function OpsPublisherConnectorsPage() {
  const enabledCount = PUBLISHER_CONNECTORS.filter((c) => c.enabled).length;

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>发布连接器</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。当前已启用连接器数量：{enabledCount}。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {PUBLISHER_CONNECTORS_NOTICE}
      </p>
      <ul className="cp-list">
        {PUBLISHER_CONNECTORS.map((conn) => (
          <li className="cp-list-row" key={conn.referenceCode}>
            <span className="cp-list-title">{conn.name}</span>
            <span className="cp-list-meta">
              参考编号 {conn.referenceCode} · 状态：{conn.enabled ? "已启用" : "未启用（默认关闭）"} · 已连接数：
              {conn.connectedCount}
            </span>
            <span className="cp-list-meta">{conn.summary}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
