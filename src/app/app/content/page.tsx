/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 3,
 *   "Content and source grounding")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: content & sourcing view for the CLIENT workspace. Fixture data only
 * (src/app/app/_fixtures.ts) - no real customer data, no database connection. Stage
 * labels use plain client-facing language only (see _fixtures.ts header note) - no
 * internal production-pipeline vocabulary.
 *
 * Checkpoint C5: each row renders two separate `ClientConfirmationControl`s
 * (../_confirmation-control) - one for content-direction confirmation, one for
 * source-type confirmation - each with its own independent three-state decision
 * (确认 / 需要修改 / 待定, see ../_confirmation.ts). Client-side state only, no submit
 * handler.
 */
import { CONTENT_SOURCING_ITEMS } from "../_fixtures";
import { ClientConfirmationControl } from "../_confirmation-control";

export default function ContentSourcingPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>内容与信源</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <ul className="cp-list">
        {CONTENT_SOURCING_ITEMS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.title}</span>
            <span className="cp-list-meta">
              参考编号 {item.referenceCode} · 状态：{item.stageLabel}
            </span>
            <span className="cp-list-summary">{item.sourceSummary}</span>
            <div className="cp-confirm-group">
              <ClientConfirmationControl subjectLabel="内容方向" />
              <ClientConfirmationControl subjectLabel="信源类型" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
