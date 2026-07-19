"use client";

import { useState } from "react";
import type { KnowledgeOpportunityBatch, UserQuestionCandidate } from "../../runtime/knowledge-opportunity/contracts.js";
import { confirmKnowledgeOpportunity, previewKnowledgeOpportunities } from "./endpoints.js";
import { useWriteAction, WriteActionFeedback } from "./WriteAction.js";

const SOURCE_LABEL = {
  KNOWLEDGE_GROUNDED_OPPORTUNITY: "来自企业知识",
  INDUSTRY_HYPOTHESIS: "行业假设，待人工核实",
} as const;

function QuestionRow({
  projectId,
  item,
  onConfirmed,
}: {
  readonly projectId: string;
  readonly item: UserQuestionCandidate;
  readonly onConfirmed: () => void;
}) {
  const action = useWriteAction(
    () => confirmKnowledgeOpportunity(projectId, item),
    onConfirmed,
  );
  return <li className="cp-list-row">
    <span className="cp-list-title">{item.question}</span>
    <span className="cp-list-meta">{SOURCE_LABEL[item.source]} · {item.audience} · {item.decisionStage === "AWARENESS" ? "需求了解" : item.decisionStage === "CONSIDERATION" ? "方案评估" : "决策确认"}</span>
    <span className="cp-list-summary">建议内容：{item.contentOpportunity}</span>
    {item.evidenceNeed.length > 0 ? <span className="cp-list-summary">确认前建议补充：{item.evidenceNeed.join("；")}</span> : null}
    {item.contentConstraints.length > 0 ? <span className="cp-list-summary">内容限制：{item.contentConstraints.join("；")}</span> : null}
    <div className="cp-actions">
      <button className="cp-confirm-button" type="button" disabled={action.state.status === "submitting"} onClick={() => action.submit()}>
        人工确认并创建内容机会
      </button>
    </div>
    <WriteActionFeedback state={action.state} successLabel="已创建内容机会，可在后续审核流程中继续处理。" />
  </li>;
}

export function KnowledgeFirstQuestionWorkspace({
  projectId,
  onConfirmed,
}: {
  readonly projectId: string;
  readonly onConfirmed: () => void;
}) {
  const [batch, setBatch] = useState<KnowledgeOpportunityBatch | null>(null);
  const generation = useWriteAction(
    () => previewKnowledgeOpportunities(projectId),
    (created) => setBatch(created),
  );
  return <section className="cp-card">
    <div className="cp-actions">
      <div>
        <h2>基于企业知识生成用户问题</h2>
        <p>关键词数据是可选增强项。即使尚未导入任何关键词，也可以先根据企业介绍、产品服务、案例和常见问题生成待确认问题。</p>
      </div>
      <button className="cp-button" type="button" disabled={generation.state.status === "submitting"} onClick={() => generation.submit()}>
        {generation.state.status === "submitting" ? "正在生成…" : "生成用户问题"}
      </button>
    </div>
    <WriteActionFeedback state={generation.state} successLabel="已根据当前企业知识生成，请逐条人工确认。" />
    {batch && batch.candidates.length === 0 ? <p className="cp-list-row cp-list-empty">当前知识内容不足以形成问题，请先补充企业介绍、产品服务、案例或常见问题。</p> : null}
    {batch && batch.candidates.length > 0 ? <ul className="cp-list">
      {batch.candidates.map((item) => <QuestionRow key={item.id} projectId={projectId} item={item} onConfirmed={onConfirmed} />)}
    </ul> : null}
  </section>;
}
