"use client";

import { useState } from "react";
import type { ArticleDraftCommandViewV1, ArticleApprovalViewV1 } from "@/runtime/commands/geo-dto.js";
import { loadArticleDrafts } from "@/components/client-runtime/endpoints.js";
import { submitDraftReview } from "@/components/client-runtime/article-commands.js";
import { useAsyncData } from "@/components/runtime/index.js";
import { useWriteAction, WriteActionFeedback } from "@/components/client-runtime/WriteAction.js";

async function doSubmitReview(draftId: string, industryProfileId: string) {
  return submitDraftReview({ articleDraftId: draftId, industryProfileId });
}

function DraftReviewRow({ draft, onReviewed }: { readonly draft: ArticleDraftCommandViewV1; readonly onReviewed: () => void }) {
  const [industryProfileId, setIndustryProfileId] = useState("");
  const { state, submit } = useWriteAction(
    (draftId: string, profileId: string) => doSubmitReview(draftId, profileId),
    onReviewed,
  );

  return (
    <li className="cp-list-row">
      <span className="cp-list-title">{draft.title}</span>
      <span className="cp-list-meta">
        v{draft.version} · {draft.sectionCount} 个章节 · {new Date(draft.compiledAt).toLocaleString("zh-CN")}
      </span>
      <div className="cp-actions">
        <label>行业画像ID（用于质量/平台/垂直审核）
          <input type="text" value={industryProfileId} onChange={(e) => setIndustryProfileId(e.target.value)} placeholder="uuid" disabled={state.status === "submitting"} />
        </label>
        <button type="button" className="cp-button cp-button-primary" onClick={() => void submit(draft.id, industryProfileId)} disabled={state.status === "submitting" || !industryProfileId.trim()}>
          {state.status === "submitting" ? "正在提交审核…" : "提交发布审核"}
        </button>
      </div>
      <WriteActionFeedback state={state} successLabel="发布审核已提交。质量、平台、垂直三项审核全部通过后，文章方可发布。" />
    </li>
  );
}

export function ArticleDraftReviewList() {
  const resource = useAsyncData<readonly ArticleDraftCommandViewV1[]>(loadArticleDrafts);
  const { state } = resource;

  return (
    <section className="cp-card">
      <div className="cp-section-header">
        <div>
          <h2>文章草稿审核</h2>
          <p>提交审核将运行质量、平台、垂直三项检查，全部通过方可发布。</p>
        </div>
      </div>
      {state.status === "loading" && <p className="cp-placeholder-note">正在加载草稿…</p>}
      {state.status === "error" && (
        <div className="cp-actions">
          <p className="cp-placeholder-note">加载失败。</p>
          <button type="button" className="cp-button" onClick={resource.reload}>重试</button>
        </div>
      )}
      {state.status === "success" && (
        state.data.length === 0
          ? <p className="cp-list-row cp-list-empty">暂无草稿。</p>
          : <ul className="cp-list">
              {state.data.map((draft) => (
                <DraftReviewRow key={draft.id} draft={draft} onReviewed={resource.reload} />
              ))}
            </ul>
      )}
    </section>
  );
}
