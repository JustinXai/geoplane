/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — pure, React-free mapping + filtering for the OPS
 * audit surfaces. Mirrors the batch-1 pattern: plain functions, unit-testable with no DOM.
 *
 * The audit read (GET /api/ops/audit) returns AuditEventViewV1[] with REAL actor / action / target
 * / timestamp. These helpers map an AuditEventViewV1 to a display row and narrow the trail to the
 * action(s) a given screen is about — they never fabricate a row, never widen the trail, and never
 * expose anything the frozen DTO does not already carry (no tokens, no secrets, no raw internals).
 */
import type { AuditEventViewV1 } from "../../runtime/api-contracts/index.js";

/** Canonical audit action codes the command routes record (see src/app/api/ops/**, /api/commands/**). */
export const OPS_ASSIGNMENT_ACTIONS: readonly string[] = ["ops.assignment.create"];
export const OPS_INVITATION_ACTIONS: readonly string[] = ["project.invitation.create"];

/** A display-ready audit row derived solely from an AuditEventViewV1's public fields. */
export interface OpsAuditRowView {
  readonly id: string;
  readonly action: string;
  /** Actor's human identifier, or a stable placeholder when the actor is unresolved/system. */
  readonly actorLabel: string;
  /** Best available target descriptor (target type + client/project id), or a dash when none. */
  readonly targetLabel: string;
  readonly occurredAt: string;
}

const NONE = "—";

/**
 * Maps one AuditEventViewV1 to a display row. Composes the most specific real target the event
 * carries (target type, then client org, then project) and never invents a value that is absent.
 */
export function toOpsAuditRow(event: AuditEventViewV1): OpsAuditRowView {
  const targetParts: string[] = [];
  if (event.targetType !== null) targetParts.push(event.targetType);
  if (event.clientOrganizationId !== null) targetParts.push(`客户 ${event.clientOrganizationId}`);
  if (event.projectId !== null) targetParts.push(`项目 ${event.projectId}`);

  return {
    id: event.id,
    action: event.action,
    actorLabel: event.actorDisplayName ?? "系统",
    targetLabel: targetParts.length > 0 ? targetParts.join(" · ") : NONE,
    occurredAt: event.occurredAt,
  };
}

/** True when there are no audit events (drives the Empty state). */
export function isAuditEmpty(events: readonly AuditEventViewV1[]): boolean {
  return events.length === 0;
}

/**
 * Narrows the audit trail to a set of action codes — used by the assignment / invitation screens to
 * show only their own real activity from the shared trail. Only ever filters (never widens), so a
 * screen can never surface an unrelated tenant's unrelated action.
 */
export function filterAuditByActions(
  events: readonly AuditEventViewV1[],
  actions: readonly string[],
): readonly AuditEventViewV1[] {
  const allowed = new Set(actions);
  return events.filter((event) => allowed.has(event.action));
}
