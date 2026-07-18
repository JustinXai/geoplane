"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — client confirmation of an enterprise knowledge
 * package's readiness, wired to the real command API (POST /api/knowledge/packages/[id]/confirm).
 *
 * This is a genuine client WRITE: the client confirms their knowledge base is ready, the command
 * moves the package to CONFIRMED (the confirmer is derived from the session server-side — never
 * hardcoded here), and on success the surrounding readiness + issues screen refreshes via onConfirmed.
 * Renders the submitting / success / forbidden / error states. Already-confirmed packages show no
 * action (a confirmed package is terminal on the client surface).
 */
import type { KnowledgePackageStatusV1, KnowledgePackageViewV1 } from "../../runtime/api-contracts/index.js";
import { confirmKnowledgePackage } from "./commands.js";
import { WriteActionFeedback, useWriteAction } from "./WriteAction.js";

export interface KnowledgePackageConfirmProps {
  /** Opaque action handle (the package id); used only for the command path, never rendered. */
  readonly packageId: string;
  readonly status: KnowledgePackageStatusV1;
  /** Refresh the readiness + issues screen after a successful confirmation. */
  readonly onConfirmed: (pkg: KnowledgePackageViewV1) => void;
}

export function KnowledgePackageConfirm({
  packageId,
  status,
  onConfirmed,
}: KnowledgePackageConfirmProps) {
  const { state, submit } = useWriteAction(
    () => confirmKnowledgePackage(packageId),
    onConfirmed,
  );

  if (status === "CONFIRMED") {
    return <p className="cp-confirm-status" data-state="CONFIRMED">知识库已确认就绪。</p>;
  }

  const submitting = state.status === "submitting";

  return (
    <div className="cp-confirm" role="group" aria-label="知识库就绪确认">
      <div className="cp-confirm-actions">
        <button
          type="button"
          className="cp-confirm-button"
          onClick={() => submit()}
          disabled={submitting}
          aria-disabled={submitting}
        >
          确认知识库就绪
        </button>
      </div>
      <WriteActionFeedback state={state} successLabel="知识库已确认就绪。" />
    </div>
  );
}
