/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md ("An AGENCY
 *   user manages multiple CLIENT organizations, but only ones it has been explicitly
 *   granted access to"), recovered/partial-source/00040000000C9C607C9A7F12-page.tsx
 *   (AssignmentForm, "只有有效分配中的客户可被代理商选择" - only clients within an
 *   active assignment can be selected by an agency)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 客户项目 (client projects) view for the AGENCY workspace. Lists only
 * the CLIENT organizations this agency currently has an ACTIVE assignment to
 * (src/app/agency/_fixtures.ts AGENCY_VISIBLE_CLIENT_PROJECTS - derived by filtering
 * AGENCY_CLIENT_ASSIGNMENTS to status === "ACTIVE"), each with its projects. No client
 * outside that fixture's ACTIVE assignment rows is reachable from this page. Fixture
 * data only - no real customer data, no database connection.
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, AGENCY_VISIBLE_CLIENT_PROJECTS } from "../_fixtures";

export default function AgencyClientProjectsPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>客户项目</h1>
          <span>占位数据 - 仅展示当前有效分配中的客户及其项目，无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      {AGENCY_VISIBLE_CLIENT_PROJECTS.map((client) => (
        <section className="cp-section" key={client.clientReferenceCode}>
          <h2>
            {client.clientOrgName} <span className="cp-list-meta">（{client.clientReferenceCode}）</span>
          </h2>
          <ul className="cp-list">
            {client.projects.map((project) => (
              <li className="cp-list-row" key={project.referenceCode}>
                <span className="cp-list-title">{project.name}</span>
                <span className="cp-list-meta">
                  参考编号 {project.referenceCode} · 阶段：{project.stageLabel} · 更新于 {project.updatedLabel}
                </span>
              </li>
            ))}
            {client.projects.length === 0 ? <li className="cp-list-row cp-list-empty">暂无项目</li> : null}
          </ul>
        </section>
      ))}
    </>
  );
}
