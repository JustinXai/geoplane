"use client";

import { useState, useEffect, type FormEvent } from "react";
import type { ArticleBriefViewV1 } from "@/runtime/commands/geo-dto.js";
import { loadOpportunityFamilies } from "@/components/client-runtime/endpoints.js";
import { createArticleBrief } from "@/components/client-runtime/article-commands.js";
import { useWriteAction, WriteActionFeedback } from "@/components/client-runtime/WriteAction.js";

const RISK_LABELS = { STANDARD: "标准风险", ESCALATED_FOR_HUMAN_REVIEW: "需人工审核" } as const;

export function ArticleBriefCreationPanel({ onBriefCreated }: { readonly onBriefCreated?: () => void }) {
  const [families, setFamilies] = useState<readonly import("@/runtime/commands/geo-dto.js").OpportunityFamilyViewV1[]>([]);
  const [loadingFamilies, setLoadingFamilies] = useState(true);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [workingTitle, setWorkingTitle] = useState("");
  const [outlineText, setOutlineText] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [riskLevel, setRiskLevel] = useState<"STANDARD" | "ESCALATED_FOR_HUMAN_REVIEW">("STANDARD");

  const { state, submit } = useWriteAction(
    async (familyId: string, title: string, outline: string[], keywords: string[], risk: "STANDARD" | "ESCALATED_FOR_HUMAN_REVIEW") => {
      return createArticleBrief({
        opportunityFamilyId: familyId, workingTitle: title, outline, targetKeywords: keywords, riskLevel: risk,
      });
    },
    onBriefCreated,
  );

  useEffect(() => {
    void loadOpportunityFamilies().then((result) => {
      setLoadingFamilies(false);
      if (result.ok) setFamilies(result.data);
    });
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outline = outlineText.split("\n").map((s) => s.trim()).filter(Boolean);
    const keywords = keywordText.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean);
    void submit(selectedFamilyId, workingTitle.trim(), outline, keywords, riskLevel);
  }

  return (
    <form className="cp-card" onSubmit={handleSubmit}>
      <div className="cp-section-header"><div><h2>创建内容简报</h2><p>选择一个已批准机会点组，填写标题和大纲。</p></div></div>
      <div className="cp-form-grid">
        <label>机会点组（需要先在内容审核中批准机会点）
          <select value={selectedFamilyId} onChange={(e) => setSelectedFamilyId(e.target.value)} required disabled={state.status === "submitting" || loadingFamilies}>
            <option value="">— 选择已批准机会点组 —</option>
            {families.map((f) => <option key={f.id} value={f.id}>家族 {f.id.slice(0, 8)}… ({f.memberOpportunityIds.length} 个机会点)</option>)}
          </select>
        </label>
        <label className="cp-field-wide">文章标题
          <input type="text" value={workingTitle} onChange={(e) => setWorkingTitle(e.target.value)} placeholder="输入文章工作标题" required disabled={state.status === "submitting"} />
        </label>
        <label className="cp-field-wide">文章大纲（每行一个章节标题）
          <textarea value={outlineText} onChange={(e) => setOutlineText(e.target.value)} placeholder={"背景介绍\n行业分析\n解决方案\n案例展示\n总结"} rows={5} required disabled={state.status === "submitting"} />
        </label>
        <label className="cp-field-wide">目标关键词（逗号或换行分隔）
          <input type="text" value={keywordText} onChange={(e) => setKeywordText(e.target.value)} placeholder="SEO关键词1, 关键词2" required disabled={state.status === "submitting"} />
        </label>
        <label>风险等级
          <select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as typeof riskLevel)} disabled={state.status === "submitting"}>
            <option value="STANDARD">{RISK_LABELS.STANDARD}</option>
            <option value="ESCALATED_FOR_HUMAN_REVIEW">{RISK_LABELS.ESCALATED_FOR_HUMAN_REVIEW}</option>
          </select>
        </label>
      </div>
      <div className="cp-actions">
        <button type="submit" className="cp-button cp-button-primary" disabled={state.status === "submitting" || !selectedFamilyId}>
          {state.status === "submitting" ? "正在创建…" : "创建内容简报"}
        </button>
      </div>
      <WriteActionFeedback state={state} successLabel="内容简报已创建。" />
    </form>
  );
}
