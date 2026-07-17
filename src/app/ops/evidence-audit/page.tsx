/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Content and source
 *   grounding" business-core item), docs/governance/SYSTEM_INVARIANTS_V1.md ("No customer
 *   data, no secrets" - no real customer attachments/evidence)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: Evidence 审计 (evidence audit) - minimal list view of fixture evidence-
 * audit entries (src/app/ops/_fixtures.ts EVIDENCE_AUDIT_EVENTS). Presentation only, no
 * real customer attachments or source-grounding payloads.
 */
import { EVIDENCE_AUDIT_EVENTS } from "../_fixtures";

export default function OpsEvidenceAuditPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>Evidence 审计</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。不包含任何真实客户证据或原始信源内容。</span>
        </div>
      </header>
      <ul className="cp-list">
        {EVIDENCE_AUDIT_EVENTS.map((ev) => (
          <li className="cp-list-row" key={ev.referenceCode}>
            <span className="cp-list-title">{ev.actionLabel}</span>
            <span className="cp-list-meta">
              {ev.targetLabel} · 参考编号 {ev.referenceCode} · {ev.timestampLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
