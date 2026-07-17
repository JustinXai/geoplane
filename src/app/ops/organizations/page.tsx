/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md ("Organization
 *   types": PLATFORM/AGENCY/CLIENT, "A PLATFORM user can manage all organizations"),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 组织 (organizations) list for the PLATFORM/ops workspace. Fixture data
 * only (src/app/ops/_fixtures.ts ORGANIZATIONS) - lists every organization across all
 * three types (PLATFORM/AGENCY/CLIENT), platform-only visibility per
 * MULTI_TENANT_ACCOUNT_MODEL_V1. Presentation only - no database connection.
 */
import { ORGANIZATIONS } from "../_fixtures";

export default function OpsOrganizationsPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>组织</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。跨全部组织类型展示，仅平台可见。</span>
        </div>
      </header>
      <section className="cp-table-wrap">
        <table className="cp-data-table">
          <thead>
            <tr>
              <th>参考编号</th>
              <th>名称</th>
              <th>类型</th>
              <th>状态</th>
              <th>创建于</th>
            </tr>
          </thead>
          <tbody>
            {ORGANIZATIONS.map((org) => (
              <tr key={org.referenceCode}>
                <td>{org.referenceCode}</td>
                <td>{org.name}</td>
                <td>{org.typeLabel}</td>
                <td>{org.statusLabel}</td>
                <td>{org.createdLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
