"use client";

/**
 * OPPOPTUNITY_BRIEF_DIRECT_FLOW_V1 (Agent B) — shared "Create Article Brief" action for
 * CONFIRMED opportunities.
 *
 * This component is usable in both the AGENCY review-queue (for approved content directions)
 * and the CLIENT content-sourcing page (for confirmed opportunities). It:
 *
 *   1. Renders a "创建内容简报" button that is enabled ONLY when the opportunity is CONFIRMED
 *      (the only status from which a brief may be created — no fabrication).
 *   2. Opens a minimal form dialog collecting:
 *        - workingTitle  (required, pre-filled from the opportunity title)
 *        - outline[]     (required, at least one section heading)
 *        - targetKeywords (required, at least one keyword)
 *        - riskLevel     (STANDARD | ESCALATED_FOR_HUMAN_REVIEW, default STANDARD)
 *   3. Calls POST /api/opportunities/[id]/brief via createBriefFromOpportunity (commands.ts).
 *   4. On success calls onBriefCreated(briefId, brief) so the caller can navigate or refresh.
 *   5. Uses the shared useWriteAction / WriteActionFeedback primitives throughout.
 *
 * Server-side tenant resolution is preserved: this component never sends an org / actor /
 * reviewer id. The reviewer is derived from the session server-side by the brief route.
 */
import { type ReactNode, useCallback, useState } from "react";
import type { ArticleBriefViewV1 } from "../../runtime/commands/geo-dto.js";
import type { OpportunityViewV1 } from "../../runtime/api-contracts/index.js";
import {
  createBriefFromOpportunity,
  type ArticleBriefRiskLevel,
} from "./commands.js";
import { WriteActionFeedback, useWriteAction } from "./WriteAction.js";

/** Status labels for brief creation eligibility. */
const BRIEF_ELIGIBLE_STATUS = "CONFIRMED";

export interface CreateBriefActionProps {
  /** The opportunity to bridge to a brief. */
  readonly opportunity: OpportunityViewV1;
  /**
   * Called with the created brief on success. The caller uses this to navigate to the
   * brief detail or content-production page.
   */
  readonly onBriefCreated: (brief: ArticleBriefViewV1) => void;
  /** Optional extra trigger button label (defaults to "创建内容简报"). */
  readonly buttonLabel?: string;
}

/** True when the opportunity status makes it eligible for brief creation. */
export function canCreateBriefFrom(opportunity: OpportunityViewV1): boolean {
  return opportunity.status === BRIEF_ELIGIBLE_STATUS;
}

interface BriefFormState {
  readonly workingTitle: string;
  readonly outlineText: string;
  readonly keywordsText: string;
  readonly riskLevel: ArticleBriefRiskLevel;
}

interface DialogProps {
  readonly opportunity: OpportunityViewV1;
  readonly onClose: () => void;
  readonly onSuccess: (brief: ArticleBriefViewV1) => void;
}

function BriefCreateDialog({ opportunity, onClose, onSuccess }: DialogProps): ReactNode {
  const [workingTitle, setWorkingTitle] = useState(opportunity.title);
  const [outlineText, setOutlineText] = useState("");
  const [keywordsText, setKeywordsText] = useState(opportunity.title);
  const [riskLevel, setRiskLevel] = useState<ArticleBriefRiskLevel>("STANDARD");

  const { state, submit, reset } = useWriteAction(
    async (): Promise<import("../../lib/api-client/http.js").Result<ArticleBriefViewV1>> => {
      const outline = outlineText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const keywords = keywordsText
        .split(/[,，、\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (outline.length === 0) {
        return {
          ok: false,
          code: "VALIDATION_FAILED",
          message: "outline requires at least one section heading.",
        };
      }
      if (keywords.length === 0) {
        return {
          ok: false,
          code: "VALIDATION_FAILED",
          message: "targetKeywords requires at least one keyword.",
        };
      }
      return createBriefFromOpportunity({
        opportunityId: opportunity.id,
        workingTitle: workingTitle.trim(),
        riskLevel,
        outline,
        targetKeywords: keywords,
      });
    },
    (brief) => {
      onSuccess(brief);
      onClose();
    },
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      reset();
      submit();
    },
    [submit, reset],
  );

  const isValid =
    workingTitle.trim().length > 0 &&
    outlineText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length > 0 &&
    keywordsText
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length > 0;

  return (
    <div
      className="cp-dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="创建内容简报"
    >
      <div className="cp-dialog-panel">
        <header className="cp-dialog-header">
          <h3>创建内容简报</h3>
          <button
            type="button"
            className="cp-dialog-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <form className="cp-dialog-form" onSubmit={handleSubmit}>
          <p className="cp-dialog-context">
            基于内容方向：
            <strong>{opportunity.title}</strong>
          </p>

          <label className="cp-form-field">
            <span className="cp-form-label">标题</span>
            <input
              className="cp-form-input"
              type="text"
              value={workingTitle}
              onChange={(e) => setWorkingTitle(e.target.value)}
              required
              placeholder="文章标题"
              aria-label="文章标题"
            />
          </label>

          <label className="cp-form-field">
            <span className="cp-form-label">
              大纲（每行一个章节，一行一个）
            </span>
            <textarea
              className="cp-form-textarea"
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              rows={5}
              placeholder={"一、背景介绍\n二、核心内容\n三、总结与建议"}
              aria-label="文章大纲"
            />
          </label>

          <label className="cp-form-field">
            <span className="cp-form-label">目标关键词（逗号或换行分隔）</span>
            <textarea
              className="cp-form-textarea"
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              rows={2}
              placeholder="关键词一, 关键词二"
              aria-label="目标关键词"
            />
          </label>

          <fieldset className="cp-form-fieldset">
            <legend className="cp-form-label">风险级别</legend>
            <div className="cp-form-radio-group">
              <label className="cp-form-radio">
                <input
                  type="radio"
                  name="riskLevel"
                  value="STANDARD"
                  checked={riskLevel === "STANDARD"}
                  onChange={() => setRiskLevel("STANDARD")}
                />
                标准
              </label>
              <label className="cp-form-radio">
                <input
                  type="radio"
                  name="riskLevel"
                  value="ESCALATED_FOR_HUMAN_REVIEW"
                  checked={riskLevel === "ESCALATED_FOR_HUMAN_REVIEW"}
                  onChange={() => setRiskLevel("ESCALATED_FOR_HUMAN_REVIEW")}
                />
                需人工审核
              </label>
            </div>
          </fieldset>

          <WriteActionFeedback state={state} successLabel="内容简报已创建。" />

          <div className="cp-dialog-actions">
            <button
              type="button"
              className="cp-button-secondary"
              onClick={onClose}
              disabled={state.status === "submitting"}
            >
              取消
            </button>
            <button
              type="submit"
              className="cp-button-primary"
              disabled={!isValid || state.status === "submitting"}
            >
              {state.status === "submitting" ? "创建中…" : "创建简报"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateBriefAction({
  opportunity,
  onBriefCreated,
  buttonLabel = "创建内容简报",
}: CreateBriefActionProps): ReactNode {
  const [open, setOpen] = useState(false);
  const eligible = canCreateBriefFrom(opportunity);

  return (
    <>
      <button
        type="button"
        className="cp-button-brief"
        disabled={!eligible}
        onClick={() => setOpen(true)}
        aria-disabled={!eligible}
        title={eligible ? buttonLabel : "仅已确认的内容方向可创建内容简报"}
      >
        {buttonLabel}
      </button>

      {open && (
        <BriefCreateDialog
          opportunity={opportunity}
          onClose={() => setOpen(false)}
          onSuccess={onBriefCreated}
        />
      )}
    </>
  );
}
