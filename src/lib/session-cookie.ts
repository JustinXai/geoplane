/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/entities.ts (PlatformRole, OrganizationType -
 *   the canonical types this session shape is built from), middleware.ts (the sole consumer)
 * reconstruction_reason: net-new acceptance-phase file (REBUILD_INTEGRATION_ACCEPTANCE_V1,
 *   section 7/8 - "/app/* 角色边界有效" etc. require something real for middleware to check;
 *   no lane built a session/cookie mechanism during the overnight rebuild, since every C1-C6
 *   checkpoint was explicitly presentation-only with no auth wiring)
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * IMPORTANT SCOPE LIMITATION, stated plainly: this is NOT a real authentication system.
 * The cookie below is a plain base64url-encoded JSON blob - NOT cryptographically signed,
 * NOT encrypted, trivially forgeable by anyone who can set a cookie. It exists solely so
 * this acceptance phase's HTTP route smoke test (section 8) and E2E scenario (section 9)
 * have something real for middleware.ts to check role/tenant boundaries against, proving
 * the *routing/isolation logic* works end-to-end over real HTTP - it does NOT prove a real
 * login flow exists, and must never be treated as production-ready session security. A real
 * session mechanism (signed/encrypted cookies or server-side session store, wired to B4's
 * real Session/sessionVersion staleness logic) remains a future checkpoint's work.
 */
import type { OrganizationType, PlatformRole } from "@/contracts/tenancy/entities";

export const SESSION_COOKIE_NAME = "geo_acceptance_session";

export interface AcceptanceSessionCookiePayload {
  actorUserId: string;
  role: PlatformRole;
  organizationId: string;
  organizationType: OrganizationType;
  /** Non-null only for a CLIENT_OWNER session - mirrors AuthorizationContext.activeClientOrganizationId. */
  activeClientOrganizationId: string | null;
}

export function encodeSessionCookie(payload: AcceptanceSessionCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns null (never throws) for a missing/malformed cookie value - callers must treat that as "no session". */
export function decodeSessionCookie(cookieValue: string | undefined | null): AcceptanceSessionCookiePayload | null {
  if (!cookieValue) return null;
  try {
    const json = Buffer.from(cookieValue, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<AcceptanceSessionCookiePayload>;
    if (
      typeof parsed.actorUserId !== "string" ||
      typeof parsed.role !== "string" ||
      typeof parsed.organizationId !== "string" ||
      typeof parsed.organizationType !== "string"
    ) {
      return null;
    }
    return {
      actorUserId: parsed.actorUserId,
      role: parsed.role as PlatformRole,
      organizationId: parsed.organizationId,
      organizationType: parsed.organizationType as OrganizationType,
      activeClientOrganizationId: parsed.activeClientOrganizationId ?? null,
    };
  } catch {
    return null;
  }
}

/** Which top-level workspace prefix a role is allowed into. Single source of truth for both middleware.ts and its tests. */
export function allowedSurfaceForRole(role: PlatformRole): "app" | "agency" | "ops" {
  switch (role) {
    case "CLIENT_OWNER":
      return "app";
    case "AGENCY_OWNER":
    case "AGENCY_OPERATOR":
      return "agency";
    case "PLATFORM_SUPER_ADMIN":
      return "ops";
  }
}
