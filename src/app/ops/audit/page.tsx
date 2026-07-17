/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx - this
 *   is a REAL recovered file (not reconstructed from the frozen spec alone): an AuditPage
 *   rendering `tenancyRepository.listAudit()` as a table with columns 时间(time)/
 *   动作(action)/目标(target)/操作者(actor, truncated to 8 chars via
 *   `actorUserId.slice(0,8)`), using the `cp-page-header` / `cp-table-wrap` / `cp-data-table`
 *   conventions and the header copy "按真实操作者保留组织、邀请、登录和客户操作记录。" This
 *   page reproduces that exact shape (column order, truncation behavior, header copy style)
 *   against this checkpoint's own fixture data. Also see docs/architecture/
 *   MULTI_TENANT_ACCOUNT_MODEL_V1.md ("Evidence corroboration": "tenancyRepository.listAudit()
 *   rendering actor/action/target/timestamp - confirms an audit-log surface keyed to real
 *   actor IDs, not anonymized data") and docs/governance/SYSTEM_INVARIANTS_V1.md ("No
 *   customer data, no secrets").
 * reconstruction_reason: the recovered file above is real evidence of shape/behavior, but
 *   this checkpoint's actual data source (a future tenancyRepository) does not exist yet on
 *   this lane, so this page reads from local fixture data (src/app/ops/_fixtures.ts
 *   AUDIT_EVENTS) instead of a real repository call. This file's shape is modeled directly
 *   on real recovered evidence, but is reconstructed against fixture data rather than a
 *   live tenancyRepository, so it is still classified C (RECONSTRUCTED_FROM_FROZEN_SPEC),
 *   not A/B, even though a corroborating recovered file exists.
 * original_file_unavailable: true
 *
 * Checkpoint C4: 账户审计 (account audit) for the PLATFORM/ops workspace. Like the
 * recovered page, the "操作者" (actor) column never shows a raw UUID - only the first 8
 * characters of the actor id, via actorDisplay() (src/app/ops/_fixtures.ts), mirroring the
 * recovered `actorUserId.slice(0,8)` convention exactly.
 */
import { AUDIT_EVENTS, actorDisplay } from "../_fixtures";

export default function OpsAuditPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">审计</p>
          <h1>账户活动</h1>
          <span>按真实操作者保留组织、邀请、登录和客户操作记录。占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <section className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>目标</th>
              <th>操作者</th>
            </tr>
          </thead>
          <tbody>
            {AUDIT_EVENTS.map((event) => (
              <tr key={event.id}>
                <td>{event.timeLabel}</td>
                <td>{event.action}</td>
                <td>{event.targetLabel}</td>
                <td>{actorDisplay(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
