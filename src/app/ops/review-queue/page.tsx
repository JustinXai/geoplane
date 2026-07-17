/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Business layer:
 *   knowledge -> keyword/question -> opportunity validation -> human review -> article
 *   family/brief -> article compiler -> quality gates" - the human review step), docs/
 *   governance/SYSTEM_INVARIANTS_V1.md ("Publication" - no automatic publication, which
 *   extends to no automatic approval here either), docs/architecture/
 *   MULTI_TENANT_ACCOUNT_MODEL_V1.md ("A PLATFORM user can manage all organizations")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 审核队列 (review queue) - the PLATFORM-WIDE view across every
 * organization (src/app/ops/_fixtures.ts PLATFORM_REVIEW_QUEUE_ITEMS), in contrast with
 * the AGENCY-scoped review queue built in C3 (src/app/agency/review-queue,
 * REVIEW_QUEUE_ITEMS in src/app/agency/_fixtures.ts). Presentation only - it does NOT
 * perform any real approve/reject action. No form, no submit handler, no button wired to
 * a write path exists on this page (same rule as the C3 agency review queue).
 */
import { PLATFORM_REVIEW_QUEUE_ITEMS, PLATFORM_REVIEW_QUEUE_NOTICE } from "../_fixtures";

export default function OpsReviewQueuePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>审核队列</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。平台级视图，覆盖全部组织。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {PLATFORM_REVIEW_QUEUE_NOTICE}
      </p>
      <ul className="cp-list">
        {PLATFORM_REVIEW_QUEUE_ITEMS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.title}</span>
            <span className="cp-list-meta">
              {item.orgName} · 参考编号 {item.referenceCode} · {item.submittedLabel} · 状态：{item.statusLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
