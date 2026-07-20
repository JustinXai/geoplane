"use client";

import { useState } from "react";
import { useAsyncData } from "@/components/runtime/index.js";
import type { ArticleBriefViewV1, ArticleDraftCommandViewV1 } from "@/runtime/commands/geo-dto.js";
import { loadArticleBriefs } from "@/components/client-runtime/endpoints.js";
import { compileArticleDraft } from "@/components/client-runtime/article-commands.js";
import { useWriteAction, WriteActionFeedback } from "@/components/client-runtime/WriteAction.js";

const RISK_LABELS = { STANDARD: "标准风险", ESCALATED_FOR_HUMAN_REVIEW: "需人工审核" } as const;

async function doCompile(briefId: string, envelopeId: string) {
  return compileArticleDraft({ articleBriefId: briefId, providerResponseEnvelopeId: envelopeId });
}

export function ArticleBriefList() {
  const resource = useAsyncData<readonly ArticleBriefViewV1[]>(loadArticleBriefs);
  const { state } = resource;

  return (
    <section className="cp-card">
      <div className="cp-section-header"><div><h2>已创建的内容简报</h2></div></div>
      {state.status === "loading" && <p className="cp-placeholder-note">正在加载简报…</p>}
      {state.status === "error" && (
        <div className="cp-actions">
          <p className="cp-placeholder-note">加载失败。</p>
          <button type="button" className="cp-button" onClick={resource.reload}>重试</button>
        </div>
      )}
      {state.status === "success" && (
        state.data.length === 0
          ? <p className="cp-list-row cp-list-empty">暂无内容简报。</p>
          : <ul className="cp-list">
              {state.data.map((brief) => (
                <BriefRow key={brief.id} brief={brief} onReload={resource.reload} />
              ))}
            </ul>
      )}
    </section>
  );
}

function BriefRow({ brief, onReload }: { readonly brief: ArticleBriefViewV1; readonly onReload: () => void }) {
  const [envelopeId, setEnvelopeId] = useState("");
  const { state, submit } = useWriteAction(
    (briefId: string, envId: string) => doCompile(briefId, envId),
    onReload,
  );

  return (
    <li className="cp-list-row">
      <span className="cp-list-title">{brief.workingTitle}</span>
      <span className="cp-list-meta">
        {RISK_LABELS[brief.riskLevel]} · {brief.outline.length} 个章节 · {new Date(brief.createdAt).toLocaleString("zh-CN")}
      </span>
      <span className="cp-list-summary">{brief.outline.join(" → ")}</span>
      <div className="cp-actions">
        <label>提供商响应信封ID（离线生成的内容指针）
          <input type="text" value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)} placeholder="uuid" disabled={state.status === "submitting"} />
        </label>
        <button type="button" className="cp-button cp-button-primary" onClick={() => void submit(brief.id, envelopeId)} disabled={state.status === "submitting" || !envelopeId.trim()}>
          {state.status === "submitting" ? "正在编译…" : "编译草稿"}
        </button>
      </div>
      <WriteActionFeedback state={state} successLabel="草稿已编译。" />
    </li>
  );
}
