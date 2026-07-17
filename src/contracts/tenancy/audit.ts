/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
 *   (checkpoint B1/B1-CORRECTION - AuditEvent shape and its comment: "Hash
 *   of (action, targetType, targetId, actorUserId, createdAt) for
 *   tamper-evidence"), migrations/0001_tenancy_foundation.sql (checkpoint
 *   B3 - audit_event table, event_hash column), and
 *   recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx - a REAL
 *   recovered file whose `AuditPage` renders
 *   `tenancyRepository.listAudit()` results as a 时间(time)/动作(action)/
 *   目标(target)/操作者(actor) table, reading `x.createdAt`, `x.action`,
 *   `x.targetType`, and `x.actorUserId` off each event - independent,
 *   code-level corroboration that an audit surface keyed to exactly those
 *   fields (the same fields entities.ts documents as the eventHash input)
 *   exists, though the hashing logic itself was not recovered.
 * reconstruction_reason: no original audit-event recording/hashing logic
 *   was recoverable from E:\GEO_RECOVERY_SAFE. The recovered page above
 *   confirms the *read* surface and its fields, not the write-side hash
 *   computation, which is reconstructed from entities.ts's doc comment.
 * original_file_unavailable: true
 *
 * Checkpoint B4 (part 3/3) - AuditEvent business logic.
 *
 * Scope note: no repository/database wiring here (see invitations.ts's
 * equivalent note) - pure, runnable business logic over entities.ts values.
 *
 * eventHash: entities.ts documents the hash input as
 * "(action, targetType, targetId, actorUserId, createdAt)". This module
 * computes it as a SHA-256 hex digest over a stable (fixed-key-order) JSON
 * stringification of exactly those five fields. This is illustrative and
 * deterministic-for-tests tamper-evidence, matching the frozen spec's
 * documented input set - it is NOT a claim of cryptographic audit-log
 * tooling (no signing key, no chaining/Merkle structure, no HSM); a real
 * tamper-evident audit log would need those on top of this.
 */
import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent } from "./entities.js";

export interface AuditEventHashInput {
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string;
  createdAt: string;
}

/**
 * Stable (fixed-key-order) JSON stringification of exactly the fields
 * entities.ts documents as the eventHash input, then SHA-256 hex digest.
 * Fixed key order (rather than relying on caller-supplied object insertion
 * order) is what makes this deterministic across two independently
 * constructed inputs with identical logical values.
 */
export function computeAuditEventHash(input: AuditEventHashInput): string {
  const stable = JSON.stringify({
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    actorUserId: input.actorUserId,
    createdAt: input.createdAt,
  });
  return createHash("sha256").update(stable).digest("hex");
}

export interface RecordAuditEventInput {
  /** Optional caller-supplied id (e.g. for deterministic tests); random UUID otherwise. */
  id?: string;
  organizationId: string;
  actorUserId: string;
  actorOrganizationId: string;
  clientOrganizationId?: string | null;
  projectId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  now: Date;
}

/** Builds a fully-formed, hashed AuditEvent record ready to persist/append. */
export function recordAuditEvent(input: RecordAuditEventInput): AuditEvent {
  const createdAt = input.now.toISOString();
  const targetType = input.targetType ?? null;
  const targetId = input.targetId ?? null;

  const eventHash = computeAuditEventHash({
    action: input.action,
    targetType,
    targetId,
    actorUserId: input.actorUserId,
    createdAt,
  });

  return {
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorOrganizationId: input.actorOrganizationId,
    clientOrganizationId: input.clientOrganizationId ?? null,
    projectId: input.projectId ?? null,
    action: input.action,
    targetType,
    targetId,
    metadata: input.metadata ?? null,
    eventHash,
    createdAt,
  };
}
