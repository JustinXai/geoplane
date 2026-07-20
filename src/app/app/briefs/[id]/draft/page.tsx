"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — Draft creation page for an ArticleBrief.
 *
 * Shows the brief summary, a "生成内容草稿" button to compile the draft,
 * displays the compiled draft with content, and a "提交门禁" button to run
 * the three publication gates.
 *
 * Flows: Brief → Draft → Gate Evaluation
 * Context auto-passes: the briefId comes from the route params.
 */
import { type ReactNode, useCallback, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAsyncData } from "@/components/runtime/index";
import { AsyncSection } from "@/components/client-runtime/AsyncSection";
import { loadBrief } from "@/components/client-runtime/briefs";
import { loadArticleDrafts } from "@/components/client-runtime/endpoints";
import { compileDraft, submitDraftReview, type CompileDraftInput } from "@/components/client-runtime/commands";
import { WriteActionFeedback, useWriteAction } from "@/components/client-runtime/WriteAction";
import type { ArticleBriefViewV1 } from "@/runtime/commands/geo-dto";
import type { ArticleDraftCommandViewV1 } from "@/runtime/commands/geo-dto";
import { readPolicyPack } from "@/runtime/read-models/domestic-workspaces";
import { defaultApiClient } from "@/lib/api-client/http";

const RISK_LABELS: Record<ArticleBriefViewV1["riskLevel"], string> = {
  STANDARD: "标准",
  ESCALATED_FOR_HUMAN_REVIEW: "需人工审核",
};

interface DraftCompileState {
  readonly status: "idle" | "compiling" | "compiled" | "submitting_gates" | "gates_passed" | "gates_failed";
  readonly draft?: ArticleDraftCommandViewV1;
  readonly gateFailureReasons?: readonly string[];
}

interface ClientDraftPageProps {
  readonly briefId: string;
}

function ClientDraftPage({ briefId }: ClientDraftPageProps) {
  const { state: briefState, reload: reloadBrief } = useAsyncData(
    () => loadBrief(briefId),
    { isEmpty: (b: ArticleBriefViewV1 | null) => b === null },
  );
  const { state: draftsState, reload: reloadDrafts } = useAsyncData(
    () => loadArticleDrafts(),
    { isEmpty: (ds: readonly ArticleDraftCommandViewV1[]) => ds.length === 0 },
  );

  const [draftState, setDraftState] = useState<DraftCompileState>({ status: "idle" });
  const [policyPackState, setPolicyPackState] = useState<{
    industryProfileId?: string;
    loaded: boolean;
  }>({ loaded: false });

  // Load the industry profile for gate submission
  const loadIndustryProfile = useCallback(async () => {
    if (policyPackState.loaded) return;
    const brief = (briefState as { data?: ArticleBriefViewV1 }).data;
    if (!brief) return;
    try {
      const pack = await readPolicyPack(defaultApiClient as any, brief.projectId);
      if (pack.industry?.id) {
        setPolicyPackState({ industryProfileId: pack.industry.id, loaded: true });
      } else {
        setPolicyPackState({ loaded: true });
      }
    } catch {
      setPolicyPackState({ loaded: true });
    }
  }, [briefState, policyPackState.loaded]);

  const existingDraft = (draftsState as { data?: readonly ArticleDraftCommandViewV1[] }).data?.find(
    (d) => d.articleBriefId === briefId,
  );

  const handleCompile = useWriteAction(
    async (): Promise<import("@/lib/api-client/http").Result<ArticleDraftCommandViewV1>> => {
      // In production, providerResponseEnvelopeId would come from an actual provider call.
      // For the UI flow, we use a placeholder that the backend handles as an offline fixture.
      const input: CompileDraftInput = {
        articleBriefId: briefId,
        providerResponseEnvelopeId: "placeholder-envelope-for-ui-flow",
      };
      return compileDraft(input);
    },
    (draft) => {
      setDraftState({ status: "compiled", draft });
    },
  );

  const handleRunGates = useWriteAction(
    async (): Promise<import("@/lib/api-client/http").Result<import("@/runtime/commands/geo-dto").ArticleApprovalViewV1>> => {
      if (!policyPackState.industryProfileId) {
        return { ok: false, code: "VALIDATION_FAILED", message: "未找到行业配置信息，请先配置项目行业资料。" };
      }
      const draft = existingDraft || draftState.draft;
      if (!draft) {
        return { ok: false, code: "VALIDATION_FAILED", message: "请先生成内容草稿。" };
      }
      return submitDraftReview({
        draftId: draft.id,
        industryProfileId: policyPackState.industryProfileId,
      });
    },
    () => {
      setDraftState((s) => ({ ...s, status: "gates_passed" }));
    },
  );

  return (
    <AsyncSection
      state={briefState}
      onRetry={reloadBrief}
      empty={<p className="cp-list-row cp-list-empty">未找到该简报。</p>}
    >
      {(brief) => (
        <div className="cp-draft-page">
          {/* Brief Summary */}
          <section className="cp-brief-summary">
            <h2>简报信息</h2>
            <dl className="cp-detail-list">
              <dt className="cp-detail-label">标题</dt>
              <dd className="cp-detail-value">{brief.workingTitle}</dd>

              <dt className="cp-detail-label">风险级别</dt>
              <dd className="cp-detail-value">{RISK_LABELS[brief.riskLevel]}</dd>

              <dt className="cp-detail-label">创建时间</dt>
              <dd className="cp-detail-value">
                {new Date(brief.createdAt).toLocaleString("zh-CN")}
              </dd>
            </dl>

            <section className="cp-brief-outline">
              <h3>文章大纲</h3>
              <ol className="cp-outline-list">
                {brief.outline.map((section, i) => (
                  <li key={i}>{section}</li>
                ))}
              </ol>
            </section>
          </section>

          {/* Compile Draft */}
          <section className="cp-draft-compile">
            <h2>内容草稿</h2>

            {existingDraft ? (
              <div className="cp-draft-existing">
                <p className="cp-placeholder-note">已存在草稿：{existingDraft.title}</p>
                <div className="cp-draft-info">
                  <span>版本：v{existingDraft.version}</span>
                  <span>章节数：{existingDraft.sectionCount}</span>
                  <span>编译时间：{new Date(existingDraft.compiledAt).toLocaleString("zh-CN")}</span>
                </div>
                <p className="cp-placeholder-note">草稿已就绪，可以提交门禁审核。</p>
              </div>
            ) : draftState.status === "idle" ? (
              <div className="cp-compile-action">
                <p className="cp-placeholder-note">点击下方按钮，基于简报生成内容草稿。</p>
                <button
                  type="button"
                  className="cp-button-primary"
                  onClick={() => {
                    loadIndustryProfile();
                    handleCompile.submit();
                  }}
                  disabled={handleCompile.state.status === "submitting"}
                >
                  {handleCompile.state.status === "submitting" ? "生成中…" : "生成内容草稿"}
                </button>
                <WriteActionFeedback state={handleCompile.state} successLabel="内容草稿已生成。" />
              </div>
            ) : draftState.status === "compiling" ? (
              <p className="cp-placeholder-note">正在生成内容草稿…</p>
            ) : draftState.status === "compiled" && draftState.draft ? (
              <div className="cp-draft-result">
                <p className="cp-placeholder-note">内容草稿已生成！</p>
                <div className="cp-draft-info">
                  <span>标题：{draftState.draft.title}</span>
                  <span>版本：v{draftState.draft.version}</span>
                  <span>章节数：{draftState.draft.sectionCount}</span>
                </div>
              </div>
            ) : null}

            <WriteActionFeedback
              state={handleCompile.state}
              successLabel="内容草稿已生成。"
            />
          </section>

          {/* Run Gates */}
          {(existingDraft || draftState.draft) && (
            <section className="cp-gate-runner">
              <h2>门禁审核</h2>

              {draftState.status === "gates_passed" ? (
                <div className="cp-gate-success">
                  <p className="cp-placeholder-note">✓ 内容已通过全部门禁审核（质量门禁、平台门禁、行业门禁）。</p>
                  <p className="cp-placeholder-note">可以进入人工审核阶段。</p>
                </div>
              ) : draftState.status === "gates_failed" ? (
                <div className="cp-gate-failure">
                  <p className="cp-callout" role="alert">
                    内容未通过门禁审核。请根据以下原因修改后重新生成：
                  </p>
                  <ul className="cp-gate-failure-list">
                    {(draftState.gateFailureReasons || []).map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="cp-gate-action">
                  <p className="cp-placeholder-note">
                    运行质量门禁、平台门禁和行业门禁。只有全部通过才能进入人工审核。
                  </p>
                  <button
                    type="button"
                    className="cp-button-primary"
                    onClick={() => handleRunGates.submit()}
                    disabled={handleRunGates.state.status === "submitting" || !policyPackState.loaded}
                  >
                    {handleRunGates.state.status === "submitting" ? "审核中…" : "提交门禁"}
                  </button>
                  <WriteActionFeedback state={handleRunGates.state} />
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </AsyncSection>
  );
}

export default function DraftPage({
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
          <h1>内容草稿</h1>
          <span>基于内容简报生成并审核内容。</span>
        </div>
      </header>

      <ClientDraftPage briefId={id} />
    </>
  );
}
