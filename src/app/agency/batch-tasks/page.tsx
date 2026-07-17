/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Workspace surfaces:
 *   client workspace, agency workspace, ops console" - an agency managing several
 *   clients needs a batch view across projects)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 批量任务 (batch tasks) list/status view for the AGENCY workspace.
 * Fixture data only (src/app/agency/_fixtures.ts BATCH_TASKS) - this page does not
 * trigger, queue, or execute any real batch job. It is a read-only status list.
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, BATCH_TASKS, BATCH_TASK_NOTICE } from "../_fixtures";

export default function AgencyBatchTasksPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>批量任务</h1>
          <span>{BATCH_TASK_NOTICE}</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {BATCH_TASK_NOTICE}
      </p>
      <ul className="cp-list">
        {BATCH_TASKS.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.name}</span>
            <span className="cp-list-meta">
              参考编号 {item.referenceCode} · 状态：{item.statusLabel} · 共 {item.itemCount} 项
            </span>
            <span className="cp-list-summary">{item.progressLabel}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
