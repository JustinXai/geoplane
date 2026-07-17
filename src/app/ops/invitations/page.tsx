/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md
 *   (tenancyRepository.revokeInvitation({ invitationId, actor, now }) behind
 *   requireSurfaceAuthorization("ops") - an ops-gated invitation-revocation path),
 *   recovered/partial-source/00040000000C9C455B787075-route.ts,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation", "No customer data, no
 *   secrets" - invitation tokens must never appear here)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 邀请 (invitations) - platform-wide invitation list/status view (fixture
 * data: src/app/ops/_fixtures.ts INVITATIONS). Presentation only - shows status per
 * invitation, does not display or fabricate any real invitation token, and does not wire
 * up the recovered revokeInvitation write path.
 */
import { INVITATIONS } from "../_fixtures";

export default function OpsInvitationsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>邀请</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。平台级邀请列表与状态视图。</span>
        </div>
      </header>
      <section className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>参考编号</th>
              <th>所属组织</th>
              <th>角色</th>
              <th>状态</th>
              <th>邀请情况</th>
            </tr>
          </thead>
          <tbody>
            {INVITATIONS.map((inv) => (
              <tr key={inv.referenceCode}>
                <td>{inv.referenceCode}</td>
                <td>{inv.orgName}</td>
                <td>{inv.roleLabel}</td>
                <td>{inv.statusLabel}</td>
                <td>{inv.invitedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
