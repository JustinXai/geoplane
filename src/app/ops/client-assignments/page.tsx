/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md ("An AGENCY
 *   user manages multiple CLIENT organizations, but only ones it has been explicitly
 *   granted access to (explicit assignment, not implicit/wildcard access)", AssignmentForm
 *   evidence: "只有有效分配中的客户可被代理商选择"), docs/governance/
 *   SYSTEM_INVARIANTS_V1.md ("Tenant isolation")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 客户分配 (client assignments) - the PLATFORM-WIDE view of every
 * AgencyClientAssignment record across the entire platform (src/app/ops/_fixtures.ts
 * PLATFORM_CLIENT_ASSIGNMENTS), covering every agency. Contrast with the AGENCY-scoped C3
 * view (src/app/agency/assignments, AGENCY_CLIENT_ASSIGNMENTS in
 * src/app/agency/_fixtures.ts), which only ever shows the single acting agency's own
 * assignments. Fixture data only, presentation only.
 */
import { PLATFORM_CLIENT_ASSIGNMENTS } from "../_fixtures";

export default function OpsClientAssignmentsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>客户分配</h1>
          <span>
            占位数据 - 无真实客户数据、无数据库连接。平台级视图，展示全平台所有代理商的客户分配记录（区别于代理商工作台的单一代理商视图）。
          </span>
        </div>
      </header>
      <section className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>参考编号</th>
              <th>代理商</th>
              <th>客户</th>
              <th>状态</th>
              <th>分配情况</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORM_CLIENT_ASSIGNMENTS.map((a) => (
              <tr key={a.referenceCode}>
                <td>{a.referenceCode}</td>
                <td>{a.agencyOrgName}</td>
                <td>{a.clientOrgName}</td>
                <td>{a.statusLabel}</td>
                <td>{a.assignedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
