"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — ArticleBrief detail page.
 *
 * Loads the brief by id (GET /api/article-briefs/[id]) and displays its key
 * fields: workingTitle, outline, riskLevel, opportunityFamilyId, createdAt.
 *
 * Agent B (p0-b-opportunity-brief-direct-flow-v1).
 */
import { use } from "react";
import { useAsyncData } from "@/components/runtime/index";
import { AsyncSection } from "@/components/client-runtime/AsyncSection";
import type { ArticleBriefViewV1 } from "@/runtime/commands/geo-dto";
import { loadBrief } from "@/components/client-runtime/briefs";

const RISK_LABELS: Record<ArticleBriefViewV1["riskLevel"], string> = {
  STANDARD: "标准",
  ESCALATED_FOR_HUMAN_REVIEW: "需人工审核",
};

interface ClientBriefDetailProps {
  readonly briefId: string;
}

function ClientBriefDetail({ briefId }: ClientBriefDetailProps) {
  const { state, reload } = useAsyncData(
    () => loadBrief(briefId),
    {
      isEmpty: (b: ArticleBriefViewV1 | null) => b === null,
    },
  );

  return (
    <AsyncSection
      state={state}
      onRetry={reload}
      empty={<p className="cp-list-row cp-list-empty">未找到该简报。</p>}
    >
      {(brief) => (
        <div className="cp-brief-detail">
          <dl className="cp-detail-list">
            <dt className="cp-detail-label">标题</dt>
            <dd className="cp-detail-value">{brief.workingTitle}</dd>

            <dt className="cp-detail-label">风险级别</dt>
            <dd className="cp-detail-value">{RISK_LABELS[brief.riskLevel]}</dd>

            <dt className="cp-detail-label">创建时间</dt>
            <dd className="cp-detail-value">
              {new Date(brief.createdAt).toLocaleString("zh-CN")}
            </dd>

            <dt className="cp-detail-label">关联内容簇 ID</dt>
            <dd className="cp-detail-value cp-detail-id">{brief.opportunityFamilyId}</dd>
          </dl>

          <section className="cp-brief-outline">
            <h2>文章大纲</h2>
            <ol className="cp-outline-list">
              {brief.outline.map((section, i) => (
                <li key={i}>{section}</li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </AsyncSection>
  );
}

export default function ClientBriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>内容简报</h1>
          <span>基于内容方向创建的内容生产简报。</span>
        </div>
      </header>

      <ClientBriefDetail briefId={id} />
    </>
  );
}
