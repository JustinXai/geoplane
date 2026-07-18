"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — 账户审计 (account audit) for the OPS (platform)
 * workspace, wired to the REAL API (GET /api/ops/audit), replacing fixtures. Renders the cross-tenant
 * audit trail (AuditEventViewV1[]) with REAL actor / action / target / timestamp.
 *
 * Access: GET /api/ops/audit is PLATFORM_SUPER_ADMIN-only; a non-platform principal returns FORBIDDEN
 * (or UNAUTHENTICATED) -> forbidden state, never the trail. Rows are mapped by toOpsAuditRow, which
 * only exposes fields the frozen AuditEventViewV1 already carries (no tokens, no secrets, no raw
 * internal ids beyond the stable event id).
 */
import { useAsyncData } from "@/components/runtime";
import { OpsAsyncView, isAuditEmpty, toOpsAuditRow } from "@/components/ops-runtime";
import { listOpsAudit } from "@/components/ops-runtime";
import type { AuditEventViewV1 } from "@/runtime/api-contracts";

export default function OpsAuditPage() {
  const { state } = useAsyncData<readonly AuditEventViewV1[]>(() => listOpsAudit(), {
    isEmpty: isAuditEmpty,
  });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">审计</p>
          <h1>账户活动</h1>
          <span>按真实操作者保留组织、邀请、登录和客户操作记录。数据来自真实审计接口。</span>
        </div>
      </header>

      <OpsAsyncView<readonly AuditEventViewV1[]>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无审计记录。</p>}
      >
        {(events) => (
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
                {events.map((event) => {
                  const row = toOpsAuditRow(event);
                  return (
                    <tr key={row.id}>
                      <td>{row.occurredAt}</td>
                      <td>{row.action}</td>
                      <td>{row.targetLabel}</td>
                      <td>{row.actorLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </OpsAsyncView>
    </>
  );
}
