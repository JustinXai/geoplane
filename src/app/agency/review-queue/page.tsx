/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Business layer:
 *   knowledge -> keyword/question -> opportunity validation -> human review -> article
 *   family/brief -> article compiler -> quality gates" - the human review step an
 *   agency queue surfaces), docs/governance/SYSTEM_INVARIANTS_V1.md ("Publication" -
 *   no automatic publication under any circumstance, which extends to no automatic
 *   approval here either)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 审核队列 (review queue) view for the AGENCY workspace. Fixture data
 * only (src/app/agency/_fixtures.ts REVIEW_QUEUE_ITEMS). This is presentation only -
 * it does NOT perform any real approve/reject action. No form, no submit handler, no
 * button wired to a write path exists on this page.
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, REVIEW_QUEUE_ITEMS, REVIEW_QUEUE_NOTICE } from "../_fixtures";

export default function AgencyReviewQueuePage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>审核队列</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {REVIEW_QUEUE_NOTICE}
      </p>
      <ul className="cp-list">
        {REVIEW_QUEUE_ITEMS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.title}</span>
            <span className="cp-list-meta">
              {item.clientOrgName} · 参考编号 {item.referenceCode} · {item.submittedLabel} · 状态：{item.statusLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
