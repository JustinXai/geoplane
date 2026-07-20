"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 — 审核队列 (review queue) for the AGENCY workspace,
 * wired to the REAL API with write actions (审批 / 退回).
 *
 * Read-only preview across the agency's authorized projects: loads GET /api/projects (scoped
 * server-side to ACTIVE-assigned clients) then GET /api/projects/[id]/review-queue per project.
 *
 * 黄金路径: 审核队列 -> 审批或退回 -> 创建交付包
 */
import { useState } from "react";
import { useAsyncData } from "@/components/runtime";
import {
  type AgencyProjectReadGroup,
  AgencyAsyncView,
  isAggregateEmpty,
  listClientReviewQueue,
  loadAgencyProjectReads,
  submitReviewDecision,
} from "@/components/agency-runtime";
import type { OpportunityViewV1 } from "@/runtime/api-contracts";

type ReviewGroups = readonly AgencyProjectReadGroup<OpportunityViewV1>[];

type Decision = "CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED";

const DECISION_LABELS: Record<Decision, string> = {
  CONFIRMED: "批准",
  CHANGES_REQUESTED: "退回修改",
  DEFERRED: "延期",
};

function ReviewActionRow({ opportunity }: { opportunity: OpportunityViewV1 }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!opportunity.review) return null;
  if (done) {
    return (
      <li className="cp-list-row">
        <span className="cp-list-title">{opportunity.title}</span>
        <span className="cp-list-meta cp-callout">已提交审核决定</span>
      </li>
    );
  }

  return (
    <>
      <button
        type="button"
        className="cp-button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
      >
        审核
      </button>
      {open && (
        <div className="cp-action-panel">
          <p className="cp-list-meta">选择审核决定：</p>
          <div className="cp-action-buttons">
            {(["CONFIRMED", "CHANGES_REQUESTED", "DEFERRED"] as Decision[]).map((decision) => (
              <button
                key={decision}
                type="button"
                className="cp-button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  const result = await submitReviewDecision(
                    opportunity.id,
                    opportunity.review!.reviewReferenceCode,
                    decision,
                    decision === "CHANGES_REQUESTED" ? note : null,
                  );
                  setPending(false);
                  if (result.ok) {
                    setDone(true);
                    setOpen(false);
                  } else {
                    setError(result.message);
                  }
                }}
              >
                {DECISION_LABELS[decision]}
              </button>
            ))}
          </div>
          {error && (
            <p className="cp-callout" role="alert">
              操作失败：{error}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export default function AgencyReviewQueuePage() {
  const { state, reload } = useAsyncData<ReviewGroups>(
    () => loadAgencyProjectReads<OpportunityViewV1>(listClientReviewQueue),
    { isEmpty: isAggregateEmpty },
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>审核队列</h1>
          <span>授权客户项目中待审核的机会点。选择审核决定后可推进流程。</span>
        </div>
      </header>

      <AgencyAsyncView<ReviewGroups>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无待审核项。</p>}
      >
        {(groups) =>
          groups.map((group) => (
            <section className="cp-section" key={group.project.id}>
              <h2>
                {group.project.name}{" "}
                <span className="cp-list-meta">
                  （{group.project.clientOrganizationName}）
                </span>
              </h2>
              <ul className="cp-list">
                {group.items.map((opportunity) => (
                  <li className="cp-list-row" key={opportunity.id}>
                    <span className="cp-list-title">{opportunity.title}</span>
                    <span className="cp-list-meta">
                      状态：{opportunity.status} · 创建于 {opportunity.createdAt}
                    </span>
                    <span className="cp-list-summary">{opportunity.summary}</span>
                    <ReviewActionRow opportunity={opportunity} />
                  </li>
                ))}
                {group.items.length === 0 ? (
                  <li className="cp-list-row cp-list-empty">该项目暂无待审核项。</li>
                ) : null}
              </ul>
            </section>
          ))
        }
      </AgencyAsyncView>
    </>
  );
}
