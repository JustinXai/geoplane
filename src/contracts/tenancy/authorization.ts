/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
 *   docs/governance/SYSTEM_INVARIANTS_V1.md
 * reconstruction_reason: no original authorization service code recoverable
 * original_file_unavailable: true
 *
 * Checkpoint B2 — Authorization Rules.
 *
 * Enforces the tenant-isolation invariants from SYSTEM_INVARIANTS_V1.md:
 *
 *   - A CLIENT_OWNER may only access their own single ACTIVE CLIENT
 *     organization (ctx.activeClientOrganizationId) — never another client
 *     org, even if its ID is known to the caller.
 *   - An AGENCY role (AGENCY_OWNER / AGENCY_OPERATOR) may only access CLIENT
 *     organizations present in ctx.allowedClientOrganizationIds (i.e. an
 *     ACTIVE AgencyClientAssignment row) — no wildcard/implicit access.
 *   - PLATFORM_SUPER_ADMIN (ctx.isPlatformAdmin === true) may access every
 *     organization.
 *   - A CLIENT_OWNER can never switch to a different client organization
 *     mid-session — activeClientOrganizationId is fixed for the life of the
 *     AuthorizationContext/session it was resolved into.
 *
 * Route handlers must call these functions against a server-resolved
 * AuthorizationContext (see entities.ts) — never trust a client-supplied
 * organization ID on its own. That is why every check here takes the whole
 * ctx plus a single target ID, and never takes two caller-supplied IDs to
 * compare against each other: there is no code path in this module that lets
 * a caller supply both "who I claim to be" and "what I want to access" and
 * have them get treated as equally trustworthy. The identity half always
 * comes from ctx, which callers do not construct from request input — it is
 * produced by session resolution.
 */

import type { AuthorizationContext } from "./entities.js";

/**
 * Thrown by the `assert*` functions on denial. Carries enough detail for
 * logging/audit without leaking cross-tenant information back to the
 * rejected caller (the message intentionally omits whether the target
 * organization even exists).
 */
export class AuthorizationDeniedError extends Error {
  readonly actorUserId: string;
  readonly actorRole: string;
  readonly targetClientOrganizationId: string;

  constructor(ctx: AuthorizationContext, targetClientOrgId: string) {
    super(
      `Actor ${ctx.actorUserId} (role ${ctx.actorRole}) is not authorized to access ` +
        `client organization ${targetClientOrgId}.`,
    );
    this.name = "AuthorizationDeniedError";
    this.actorUserId = ctx.actorUserId;
    this.actorRole = ctx.actorRole;
    this.targetClientOrganizationId = targetClientOrgId;
  }
}

/**
 * Returns true iff `ctx` (a server-resolved AuthorizationContext) is
 * permitted to access the CLIENT organization identified by
 * `targetClientOrgId`.
 *
 * This function trusts only `ctx` for identity/grants; `targetClientOrgId`
 * is treated purely as "what is being requested", never as a second source
 * of truth about who the actor is or what they are allowed to touch. There
 * is deliberately no overload that accepts an actor-supplied
 * activeClientOrganizationId or allow-list — those must already be baked
 * into `ctx` by session resolution before this function is ever called.
 */
export function canAccessClientOrganization(ctx: AuthorizationContext, targetClientOrgId: string): boolean {
  if (ctx.isPlatformAdmin) {
    return true;
  }

  switch (ctx.actorRole) {
    case "PLATFORM_SUPER_ADMIN":
      // Defensive: PLATFORM_SUPER_ADMIN implies isPlatformAdmin, but do not
      // rely solely on the flag if the two ever disagree — the role wins.
      return true;

    case "CLIENT_OWNER":
      // Fixed for the session: the only client org a CLIENT_OWNER may ever
      // reach is the single ACTIVE one resolved onto their context. There is
      // no mechanism here to substitute a different org, mid-session or
      // otherwise.
      return ctx.activeClientOrganizationId !== null && ctx.activeClientOrganizationId === targetClientOrgId;

    case "AGENCY_OWNER":
    case "AGENCY_OPERATOR":
      // Explicit allow-list only, sourced from ACTIVE AgencyClientAssignment
      // rows. No wildcard, no implicit "agency can see all its clients"
      // shortcut.
      return ctx.allowedClientOrganizationIds.includes(targetClientOrgId);

    default:
      return false;
  }
}

/**
 * Same rule as `canAccessClientOrganization`, but throws
 * `AuthorizationDeniedError` instead of returning false. This is the shape
 * route handlers should call directly: fail closed by default.
 */
export function assertCanAccessClientOrganization(ctx: AuthorizationContext, targetClientOrgId: string): void {
  if (!canAccessClientOrganization(ctx, targetClientOrgId)) {
    throw new AuthorizationDeniedError(ctx, targetClientOrgId);
  }
}

/**
 * Platform-wide check, independent of any specific client organization —
 * e.g. for platform-only admin surfaces. Mirrors ctx.isPlatformAdmin /
 * the PLATFORM_SUPER_ADMIN role, kept as a named predicate so call sites
 * read intent rather than re-deriving it inline.
 */
export function isPlatformAdmin(ctx: AuthorizationContext): boolean {
  return ctx.isPlatformAdmin || ctx.actorRole === "PLATFORM_SUPER_ADMIN";
}

export function assertIsPlatformAdmin(ctx: AuthorizationContext): void {
  if (!isPlatformAdmin(ctx)) {
    throw new AuthorizationDeniedError(ctx, "<platform-scope>");
  }
}
