"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 — ArticleBrief listing page.
 *
 * Loads all briefs for the agency's authorized clients (GET /api/article-briefs).
 *
 * Agent B (p0-b-opportunity-brief-direct-flow-v1).
 */
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView } from "@/components/agency-runtime";
import type { ArticleBriefViewV1 } from "@/runtime/commands/geo-dto";
import { loadBriefs } from "@/components/client-runtime/briefs";

const RISK_LABELS: Record<ArticleBriefViewV1["riskLevel"], string> = {
  STANDARD: "标准",
  ESCALATED_FOR_HUMAN_REVIEW: "需人工审核",
};

export default function AgencyBriefsPage() {
  const { state } = useAsyncData(
    loadBriefs,
    {
      isEmpty: (b: readonly ArticleBriefViewV1[]) => b.length === 0,
    },
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>内容简报</h1>
          <span>已创建的内容简报只读列表。</span>
        </div>
      </header>

      <AgencyAsyncView<readonly ArticleBriefViewV1[]>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无内容简报。</p>}
      >
        {(briefs) => (
          <ul className="cp-list">
            {briefs.map((brief) => (
              <li className="cp-list-row" key={brief.id}>
                <span className="cp-list-title">{brief.workingTitle}</span>
                <span className="cp-list-meta">
                  风险：{RISK_LABELS[brief.riskLevel]} · 创建于{" "}
                  {new Date(brief.createdAt).toLocaleString("zh-CN")}
                </span>
                <span className="cp-list-summary">
                  {brief.outline.length} 个章节 · {brief.outline.slice(0, 3).join(" · ")}
                  {brief.outline.length > 3 ? "…" : ""}
                </span>
                <div className="cp-brief-group">
                  <a
                    href={`/agency/briefs/${encodeURIComponent(brief.id)}`}
                    className="cp-button-link"
                  >
                    查看详情
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AgencyAsyncView>
    </>
  );
}
