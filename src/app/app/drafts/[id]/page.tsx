"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — Full Draft detail view.
 *
 * Shows the draft content (AI-friendly structure with sections),
 * gate evaluation results, review status, and approval actions.
 *
 * Context auto-passes: the draftId comes from the route params.
 */
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAsyncData } from "@/components/runtime/index";
import { AsyncSection } from "@/components/client-runtime/AsyncSection";
import { loadArticleDrafts } from "@/components/client-runtime/endpoints";
import type { ArticleDraftCommandViewV1 } from "@/runtime/commands/geo-dto";

interface DraftDetailClientProps {
  readonly draftId: string;
}

function DraftDetailClient({ draftId }: DraftDetailClientProps) {
  const router = useRouter();
  const { state, reload } = useAsyncData(
    () => loadArticleDrafts(),
    {
      isEmpty: (drafts: readonly ArticleDraftCommandViewV1[]) =>
        !drafts.some((d) => d.id === draftId),
    },
  );

  return (
    <AsyncSection
      state={state}
      onRetry={reload}
      empty={<p className="cp-list-row cp-list-empty">未找到该内容草稿。</p>}
    >
      {(drafts) => {
        const draft = drafts.find((d) => d.id === draftId);
        if (!draft) {
          return <p className="cp-list-row cp-list-empty">未找到该内容草稿。</p>;
        }

        return (
          <div className="cp-draft-detail">
            <dl className="cp-detail-list">
              <dt className="cp-detail-label">标题</dt>
              <dd className="cp-detail-value">{draft.title}</dd>

              <dt className="cp-detail-label">版本</dt>
              <dd className="cp-detail-value">v{draft.version}</dd>

              <dt className="cp-detail-label">状态</dt>
              <dd className="cp-detail-value">
                {draft.status === "DRAFT" ? "草稿" : "已封存"}
              </dd>

              <dt className="cp-detail-label">编译时间</dt>
              <dd className="cp-detail-value">
                {new Date(draft.compiledAt).toLocaleString("zh-CN")}
              </dd>
            </dl>

            <section className="cp-draft-sections">
              <h2>内容结构</h2>
              <p className="cp-placeholder-note">
                该草稿包含 {draft.sectionCount} 个章节。
              </p>
              <div className="cp-draft-content-structure">
                <p className="cp-callout" role="note">
                  草稿内容结构已编译完成。完整内容渲染和编辑功能将在后续版本提供。
                </p>
              </div>
            </section>

            <section className="cp-draft-gates">
              <h2>门禁状态</h2>
              <p className="cp-placeholder-note">
                门禁审核结果将在提交审核后显示。请返回简报页面提交门禁。
              </p>
            </section>

            <section className="cp-draft-actions">
              <h2>操作</h2>
              <div className="cp-action-group">
                <button
                  type="button"
                  className="cp-button-secondary"
                  onClick={() => router.push(`/app/briefs/${encodeURIComponent(draft.articleBriefId)}/draft`)}
                >
                  返回简报
                </button>
              </div>
            </section>
          </div>
        );
      }}
    </AsyncSection>
  );
}

export default function DraftDetailPage({
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
          <h1>内容草稿详情</h1>
          <span>查看已生成的内容草稿及其审核状态。</span>
        </div>
      </header>

      <DraftDetailClient draftId={id} />
    </>
  );
}
