"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — 草稿详情 (Draft Detail) page.
 *
 * Shows: title, abstract, body, content source, current version, gate status.
 * When gate = FAILED: shows issues, repair summary, repaired version.
 *
 * Operational chain: Draft 详情 -> 运行轻门禁 -> 查看修复结果 -> 提交人工审核
 */
import { use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { useAsyncData } from "@/components/runtime";
import { AsyncSection } from "@/components/client-runtime/AsyncSection.js";
import { loadDraftDetail } from "@/components/client-runtime/endpoints.js";
import { formatDateLabel } from "@/components/client-runtime/view-models.js";

const RISK_LABELS: Record<string, string> = {
  STANDARD: "标准",
  ESCALATED_FOR_HUMAN_REVIEW: "需人工审核",
};

const GATE_STATUS_LABELS: Record<string, string> = {
  PASSED: "通过",
  FAILED: "未通过",
};

function GateResultCard({
  label,
  result,
}: {
  label: string;
  result: { status: string; failureReasons: readonly string[]; evaluatedAt: string | null };
}) {
  const passed = result.status === "PASSED";
  return (
    <div className={`cp-card ${passed ? "cp-card-passed" : "cp-card-failed"}`}>
      <p className="cp-card-label">{label}</p>
      <p className="cp-card-value">
        {GATE_STATUS_LABELS[result.status] ?? result.status}
      </p>
      {result.failureReasons.length > 0 && (
        <ul>
          {result.failureReasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      )}
      {result.evaluatedAt && (
        <p className="cp-list-meta">评估于 {formatDateLabel(result.evaluatedAt)}</p>
      )}
    </div>
  );
}

export default function DraftDetailPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = use(params);
  const { state, reload } = useAsyncData(
    () => loadDraftDetail(draftId),
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>草稿详情</h1>
          <span>草稿内容与门禁状态。</span>
        </div>
      </header>

      <AsyncSection
        state={state}
        onRetry={reload}
        empty={<p className="cp-list-row cp-list-empty">未找到草稿。</p>}
      >
        {(draft) => (
          <div className="cp-detail-layout">
            <section className="cp-section">
              <h2>基本信息</h2>
              <dl className="cp-description-list">
                <dt>标题</dt>
                <dd>{draft.title}</dd>
                <dt>版本</dt>
                <dd>v{draft.version}</dd>
                <dt>状态</dt>
                <dd>{draft.status}</dd>
                <dt>编译时间</dt>
                <dd>{formatDateLabel(draft.compiledAt)}</dd>
                <dt>内容来源</dt>
                <dd>简报 {formatDateLabel(draft.compiledAt)}</dd>
              </dl>
            </section>

            <section className="cp-section">
              <h2>简报摘要</h2>
              <dl className="cp-description-list">
                <dt>工作标题</dt>
                <dd>{draft.briefWorkingTitle}</dd>
                <dt>风险等级</dt>
                <dd>{RISK_LABELS[draft.briefRiskLevel] ?? draft.briefRiskLevel}</dd>
                <dt>章节数</dt>
                <dd>{draft.briefOutline.length} 个</dd>
              </dl>
              {draft.briefOutline.length > 0 && (
                <>
                  <h3>大纲</h3>
                  <ol>
                    {draft.briefOutline.map((heading, i) => (
                      <li key={i}>{heading}</li>
                    ))}
                  </ol>
                </>
              )}
            </section>

            <section className="cp-section">
              <h2>正文章节</h2>
              {draft.sections.length > 0 ? (
                <ol>
                  {draft.sections.map((section) => (
                    <li key={section.order}>{section.heading}</li>
                  ))}
                </ol>
              ) : (
                <p className="cp-placeholder-note">暂无章节内容。</p>
              )}
            </section>

            <section className="cp-section">
              <h2>门禁状态</h2>
              <div className="cp-card-grid">
                <GateResultCard label="质量门禁" result={draft.qualityGate} />
                <GateResultCard label="平台门禁" result={draft.platformGate} />
                <GateResultCard label="垂直门禁" result={draft.verticalGate} />
              </div>
              {draft.hasGateResults && (
                <p className="cp-list-meta">
                  {draft.qualityGate.status === "PASSED" &&
                  draft.platformGate.status === "PASSED" &&
                  draft.verticalGate.status === "PASSED"
                    ? "全部门禁已通过，可提交人工审核。"
                    : "门禁未全部通过，需修复后重试。"}
                </p>
              )}
              {!draft.hasGateResults && (
                <p className="cp-placeholder-note">门禁尚未运行。</p>
              )}
            </section>

            {draft.approvalId && (
              <section className="cp-section">
                <h2>审批记录</h2>
                <dl className="cp-description-list">
                  <dt>审批 ID</dt>
                  <dd>{draft.approvalId}</dd>
                  <dt>审批时间</dt>
                  <dd>{formatDateLabel(draft.approvalApprovedAt)}</dd>
                </dl>
              </section>
            )}
          </div>
        )}
      </AsyncSection>
    </>
  );
}
