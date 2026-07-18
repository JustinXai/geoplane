"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — 邀请 (invitations) for the OPS (platform) workspace.
 * No dedicated invitations READ endpoint exists yet (invitation creation is a POST command), so this
 * screen is wired to the REAL audit trail (GET /api/ops/audit) narrowed to the invitation action
 * code — showing REAL invitation activity with real actor / target / timestamp, replacing the
 * fixture table. Invitation tokens are never carried by the audit DTO and never rendered. No
 * fabricated rows.
 *
 * Access: GET /api/ops/audit is PLATFORM_SUPER_ADMIN-only; a non-platform principal returns FORBIDDEN
 * (or UNAUTHENTICATED) -> forbidden state, never any invitation data.
 */
import { useAsyncData } from "@/components/runtime";
import {
  OPS_INVITATION_ACTIONS,
  OpsAsyncView,
  filterAuditByActions,
  listOpsAudit,
  toOpsAuditRow,
} from "@/components/ops-runtime";
import type { AuditEventViewV1 } from "@/runtime/api-contracts";

export default function OpsInvitationsPage() {
  const { state } = useAsyncData<readonly AuditEventViewV1[]>(() => listOpsAudit({ limit: 200 }), {
    isEmpty: (events) => filterAuditByActions(events, OPS_INVITATION_ACTIONS).length === 0,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>邀请</h1>
          <span>
            平台级视图。邀请活动来自真实审计记录（暂无专用的邀请读取接口），绝不显示或伪造任何邀请令牌。
          </span>
        </div>
      </header>

      <OpsAsyncView<readonly AuditEventViewV1[]>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无邀请记录。</p>}
      >
        {(events) => {
          const rows = filterAuditByActions(events, OPS_INVITATION_ACTIONS).map(toOpsAuditRow);
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
