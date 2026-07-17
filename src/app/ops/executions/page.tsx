/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Business layer:
 *   knowledge -> keyword/question -> opportunity validation -> human review -> article
 *   family/brief -> article compiler -> quality gates" - execution records are the ops-
 *   visible trace of that chain running), docs/governance/SYSTEM_INVARIANTS_V1.md
 *   ("Determinism where the business chain requires it")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 执行记录 (execution records) - a minimal list view of fixture
 * "execution" entries (src/app/ops/_fixtures.ts EXECUTION_RECORDS). Deliberately treated
 * as opaque records (id/status/timestamp only) - this checkpoint does not invent a
 * detailed provider-call or pipeline-step schema. Presentation only.
 */
import { EXECUTION_RECORDS } from "../_fixtures";

export default function OpsExecutionsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>执行记录</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。仅作为不透明记录展示，不包含具体执行明细。</span>
        </div>
      </header>
      <ul className="cp-list">
        {EXECUTION_RECORDS.map((exe) => (
          <li className="cp-list-row" key={exe.referenceCode}>
            <span className="cp-list-title">{exe.referenceCode}</span>
            <span className="cp-list-meta">
              状态：{exe.statusLabel} · {exe.timestampLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
