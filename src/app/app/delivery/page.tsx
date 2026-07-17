/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 4,
 *   "Client delivery"; "Publication principles" - platform-neutral, no automatic
 *   publication, no default distribution target), docs/governance/SYSTEM_INVARIANTS_V1.md
 *   ("Publication")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: delivery center view for the CLIENT workspace. Fixture data only
 * (src/app/app/_fixtures.ts) - no real customer data, no database connection.
 *
 * Per SYSTEM_INVARIANTS_V1 "Publication": no default publish/distribution UI. Every
 * fixture row shows 0 selected distribution channels and this page renders an explicit
 * notice that channel selection is a manual, opt-in action - never a default. This
 * checkpoint does not implement channel selection itself (no distribution UI beyond the
 * notice), so there is no control here that could default to "on".
 */
import { DELIVERY_CHANNEL_NOTICE, DELIVERY_ITEMS } from "../_fixtures";

export default function DeliveryCenterPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>交付中心</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {DELIVERY_CHANNEL_NOTICE}
      </p>
      <ul className="cp-list">
        {DELIVERY_ITEMS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.title}</span>
            <span className="cp-list-meta">
              参考编号 {item.referenceCode} · 状态：{item.statusLabel} · {item.readyLabel}
            </span>
            <span className="cp-list-summary">已选择分发渠道：{item.selectedChannelCount} 个</span>
          </li>
        ))}
      </ul>
    </>
  );
}
