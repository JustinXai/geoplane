/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 4,
 *   "Client delivery"; "Publication principles" - platform-neutral, no automatic
 *   publication, no default distribution target), docs/governance/SYSTEM_INVARIANTS_V1.md
 *   ("Publication"), src/app/app/delivery/page.tsx (checkpoint C2 client-workspace
 *   delivery center - same no-auto-publish rule applied here for the agency view)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 交付包 (delivery packages) list view for the AGENCY workspace.
 * Fixture data only (src/app/agency/_fixtures.ts AGENCY_DELIVERY_PACKAGES). Per
 * SYSTEM_INVARIANTS_V1 "Publication": no automatic publication under any circumstance
 * - every fixture row shows 0 auto-published items, same rule as the client
 * workspace's delivery center (src/app/app/delivery/page.tsx).
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, AGENCY_DELIVERY_NOTICE, AGENCY_DELIVERY_PACKAGES } from "../_fixtures";

export default function AgencyDeliveryPackagesPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>交付包</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {AGENCY_DELIVERY_NOTICE}
      </p>
      <ul className="cp-list">
        {AGENCY_DELIVERY_PACKAGES.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.title}</span>
            <span className="cp-list-meta">
              {item.clientOrgName} · 参考编号 {item.referenceCode} · 状态：{item.statusLabel}
            </span>
            <span className="cp-list-summary">已自动发布：{item.autoPublishedCount} 个</span>
          </li>
        ))}
      </ul>
    </>
  );
}
