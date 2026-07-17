/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (organization
 *   types and membership model), `rebuild/tenancy-auth` branch's
 *   src/contracts/tenancy/entities.ts `PlatformRole` union (AGENCY_OWNER /
 *   AGENCY_OPERATOR role names - that file is not present on this lane's branch yet,
 *   see the AgencyTeamRole comment in src/app/agency/_fixtures.ts for why it is
 *   mirrored locally rather than imported)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 团队与权限 (team & permissions) list view for the AGENCY workspace.
 * Fixture data only (src/app/agency/_fixtures.ts AGENCY_TEAM_MEMBERS) - no real user
 * data, no database connection, no invite/role-change forms wired to anything.
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, AGENCY_TEAM_MEMBERS } from "../_fixtures";

export default function AgencyTeamPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>团队与权限</h1>
          <span>占位数据 - 无真实用户数据、无数据库连接。</span>
        </div>
      </header>
      <ul className="cp-list">
        {AGENCY_TEAM_MEMBERS.map((member) => (
          <li className="cp-list-row" key={member.referenceCode}>
            <span className="cp-list-title">{member.displayName}</span>
            <span className="cp-list-meta">
              参考编号 {member.referenceCode} · 角色：{member.roleLabel}（{member.role}） · 状态：{member.statusLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
