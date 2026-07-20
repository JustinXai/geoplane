/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — typed WRITE-action wrappers for the CLIENT
 * workspace, built on F1's ApiClient (src/lib/api-client/http.ts) and the real command routes from
 * BUSINESS_COMMAND_API_V1 / KNOWLEDGE_API_V1.
 *
 * SERVER-DERIVED ACTOR (SYSTEM_INVARIANTS_V1): the reviewer / confirmer identity is ALWAYS resolved
 * server-side from the authenticated session. These helpers therefore NEVER accept, build, or send
 * a client-supplied actor / reviewer / approver / organization / tenant id in the request body —
 * the command routes read those from the session and from the persisted subject, never from input.
 * Each helper posts to a real route and returns the same discriminated Result the read loaders use,
 * so the calling component drives one submitting / success / forbidden / error pipeline.
 */
import type { KnowledgePackageViewV1 } from "../../runtime/api-contracts/index.js";
import type { ClientReviewDecisionValue } from "../../contracts/tenancy/entities.js";
import type { ArticleBriefPlanningContextV1 } from "../../contracts/geo-business/entities.js";
import type { HumanReviewDecisionViewV1 } from "../../runtime/commands/geo-dto.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/http.js";

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// ---------------------------------------------------------------------------
// Opportunity review — POST /api/opportunities/[id]/reviews
// ---------------------------------------------------------------------------

/**
 * The client-facing three-state review decision (frozen tenancy ClientReviewDecisionValue): confirm
 * the content direction, ask for changes, or defer it. There is no default / omission path to an
 * approval (never auto-approved). CONFIRMED maps server-side to an APPROVED human-review outcome;
 * DEFERRED to a held (non-approved) one.
 */
export type OpportunityReviewDecision = ClientReviewDecisionValue;

export interface OpportunityReviewInput {
  /** Opportunity id — opaque action handle (OpportunityViewV1.id); used only in the path, never rendered. */
  readonly opportunityId: string;
  /**
   * The OPAQUE, tamper-evident review reference (OpportunityViewV1.review.reviewReferenceCode). It is
   * NEVER a raw validation UUID — the server verifies + decodes it. The client treats it as opaque.
   */
  readonly reviewReferenceCode: string;
  /** The version the client read (OpportunityViewV1.review.reviewVersion) — optimistic concurrency. */
  readonly reviewVersion: number;
  readonly decision: OpportunityReviewDecision;
  /** Required by the route for CHANGES_REQUESTED / DEFERRED; omitted (not sent) for CONFIRMED. */
  readonly note?: string;
}

/**
 * Record the client's review decision on an opportunity. The reviewer is derived from the session
 * server-side — this body carries only the OPAQUE review reference, the version, the decision and,
 * when required, a note. It NEVER carries a reviewer / actor / org id, nor any raw internal UUID.
 */
export function submitOpportunityReview(
  input: OpportunityReviewInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<HumanReviewDecisionViewV1>> {
  const hasNote = input.note !== undefined && input.note !== "";
  const body = {
    reviewReferenceCode: input.reviewReferenceCode,
    reviewVersion: input.reviewVersion,
    decision: input.decision,
    ...(hasNote ? { note: input.note } : {}),
  };
  return client.request<HumanReviewDecisionViewV1>(
    `/api/opportunities/${enc(input.opportunityId)}/reviews`,
    { method: "POST", body },
  );
}

// ---------------------------------------------------------------------------
// Knowledge package confirmation — POST /api/knowledge/packages/[id]/confirm
// ---------------------------------------------------------------------------

/**
 * Confirm the client's knowledge package is ready (moves it to CONFIRMED and stamps confirmed_at/by,
 * returning the refreshed package view). The confirmer is derived from the session server-side; this
 * request carries no body at all — the only reference is the package id in the path (which the client
 * already holds for the readiness screen). Never sends an actor / org id.
 */
export function confirmKnowledgePackage(
  packageId: string,
  client: ApiClient = defaultApiClient,
): Promise<Result<KnowledgePackageViewV1>> {
  return client.request<KnowledgePackageViewV1>(
    `/api/knowledge/packages/${enc(packageId)}/confirm`,
    { method: "POST" },
  );
}

export interface KnowledgeFileUploadInput {
  readonly packageId: string;
  readonly file: File;
  readonly title?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** Uploads a user-selected file to an already authorized knowledge package. */
export async function uploadKnowledgeFile(
  input: KnowledgeFileUploadInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<unknown>> {
  const contentBase64 = bytesToBase64(new Uint8Array(await input.file.arrayBuffer()));
  return client.request<unknown>(`/api/knowledge/packages/${enc(input.packageId)}/files`, {
    method: "POST",
    body: {
      filename: input.file.name,
      contentType: input.file.type || "application/octet-stream",
      contentBase64,
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// ArticleBrief creation from Opportunity — POST /api/opportunities/[id]/brief
// ---------------------------------------------------------------------------

export type ArticleBriefRiskLevel = ArticleBriefPlanningContextV1["riskLevel"];

export interface CreateBriefFromOpportunityInput {
  readonly opportunityId: string;
  readonly workingTitle: string;
  readonly riskLevel: ArticleBriefRiskLevel;
  readonly outline: readonly string[];
  readonly targetKeywords: readonly string[];
}

/** Create an ArticleBrief atomically from an Opportunity (validation + approval + family + brief). */
export function createBriefFromOpportunity(
  input: CreateBriefFromOpportunityInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<import("../../runtime/commands/geo-dto.js").ArticleBriefViewV1>> {
  return client.request<import("../../runtime/commands/geo-dto.js").ArticleBriefViewV1>(
    `/api/opportunities/${enc(input.opportunityId)}/brief`,
    {
      method: "POST",
      body: {
        workingTitle: input.workingTitle,
        riskLevel: input.riskLevel,
        outline: input.outline,
        targetKeywords: input.targetKeywords,
      },
    },
  );
}
