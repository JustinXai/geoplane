"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — 客户分配 (client assignments) for the OPS (platform)
 * workspace. No dedicated assignments READ endpoint exists yet (the assignment route is a POST
 * command, /api/ops/assignments), so this screen is wired to the REAL audit trail (GET /api/ops/
 * audit) narrowed to the assignment action code — showing REAL platform assignment activity with
 * real actor / target / timestamp, replacing the fixture table. No fabricated rows.
 *
 * Access: GET /api/ops/audit is PLATFORM_SUPER_ADMIN-only; a non-platform principal returns FORBIDDEN
 * (or UNAUTHENTICATED) -> forbidden state, never any assignment data.
 */
import { useAsyncData } from "@/components/runtime";
import {
  OPS_ASSIGNMENT_ACTIONS,
  OpsAsyncView,
  filterAuditByActions,
  listOpsAudit,
  toOpsAuditRow,
} from "@/components/ops-runtime";
import type { AuditEventViewV1 } from "@/runtime/api-contracts";

export default function OpsClientAssignmentsPage() {
  const { state } = useAsyncData<readonly AuditEventViewV1[]>(() => listOpsAudit({ limit: 200 }), {
    isEmpty: (events) => filterAuditByActions(events, OPS_ASSIGNMENT_ACTIONS).length === 0,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>客户分配</h1>
          <span>
            平台级视图。分配活动来自真实审计记录（暂无专用的分配读取接口）；展示全平台的客户分配操作。
          </span>
        </div>
      </header>

      <OpsAsyncView<readonly AuditEventViewV1[]>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无客户分配记录。</p>}
      >
        {(events) => {
          const rows = filterAuditByActions(events, OPS_ASSIGNMENT_ACTIONS).map(toOpsAuditRow);
          return (
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
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.occurredAt}</td>
                      <td>{row.action}</td>
                      <td>{row.targetLabel}</td>
                      <td>{row.actorLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        }}
      </OpsAsyncView>
    </>
  );
}
