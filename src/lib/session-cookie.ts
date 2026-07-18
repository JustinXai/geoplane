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
 * SIGNED_SESSION_COOKIE_V1: the cookie is now HMAC-SHA256 signed with an absolute expiry
 * (session-signing.ts). `encodeSessionCookie` emits a signed token; `decodeSessionCookie` verifies
 * the signature + expiry with the current key and returns null for any missing/tampered/expired/
 * wrong-key/malformed value. This closes the previous "unsigned, trivially forgeable base64 blob"
 * weakness: a hand-forged raw base64 cookie no longer verifies. The PUBLIC API (SESSION_COOKIE_NAME,
 * encodeSessionCookie, decodeSessionCookie, allowedSurfaceForRole, AcceptanceSessionCookiePayload)
 * and the payload shape are unchanged, so every existing caller/test keeps working — an encoded
 * cookie still round-trips through decode; only forged/expired/tampered cookies are now rejected.
 *
 * Authorization is still re-derived server-side from the persisted Session + Organization; the
 * cookie only asserts *which user* (SYSTEM_INVARIANTS_V1). Signing hardens that assertion against
 * forgery; it is not a substitute for the server-side session/staleness checks the runtime already
 * performs.
 */
import type { OrganizationType, PlatformRole } from "@/contracts/tenancy/entities";
import { signSessionCookieValue, verifySignedSessionToken } from "./session-signing.js";

export const SESSION_COOKIE_NAME = "geo_acceptance_session";

export interface AcceptanceSessionCookiePayload {
  actorUserId: string;
  role: PlatformRole;
  organizationId: string;
  organizationType: OrganizationType;
  /** Non-null only for a CLIENT_OWNER session - mirrors AuthorizationContext.activeClientOrganizationId. */
  activeClientOrganizationId: string | null;
}

/** Signs the payload into an HMAC-signed, expiring session cookie value (see session-signing.ts). */
export function encodeSessionCookie(payload: AcceptanceSessionCookiePayload): string {
  const payloadB64Url = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return signSessionCookieValue(payloadB64Url);
}

/** Parses (and shape-validates) the base64url payload segment. Null for malformed/invalid JSON. */
function parsePayloadSegment(payloadB64Url: string): AcceptanceSessionCookiePayload | null {
  try {
    const json = Buffer.from(payloadB64Url, "base64url").toString("utf8");
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

/**
 * Verifies the signature + expiry and returns the payload, or null (never throws) for any
 * missing/tampered/expired/wrong-key/malformed cookie value - callers must treat null as "no
 * session". A plain (unsigned) base64 JSON blob fails signature verification and is rejected.
 */
export function decodeSessionCookie(cookieValue: string | undefined | null): AcceptanceSessionCookiePayload | null {
  if (!cookieValue) return null;
  const payloadB64Url = verifySignedSessionToken(cookieValue)?.payloadB64Url;
  if (payloadB64Url === undefined) return null;
  return parsePayloadSegment(payloadB64Url);
}

/**
 * The verified payload plus the signed token metadata (issue/expiry timestamps). `issuedAt` is the
 * cookie's own trustworthy issue time — the source the server-side runtime uses for an idle-window
 * check when no per-request last-activity column exists. Null (never throws) for any
 * missing/tampered/expired/wrong-key/malformed value, exactly like decodeSessionCookie.
 */
export interface DecodedSessionCookie {
  readonly payload: AcceptanceSessionCookiePayload;
  /** ms epoch the cookie was signed at. */
  readonly issuedAt: number;
  /** ms epoch the cookie's signed TTL expires at. */
  readonly expiresAt: number;
}

export function decodeSessionCookieWithMeta(
  cookieValue: string | undefined | null,
): DecodedSessionCookie | null {
  if (!cookieValue) return null;
  const verified = verifySignedSessionToken(cookieValue);
  if (verified === null) return null;
  const payload = parsePayloadSegment(verified.payloadB64Url);
  if (payload === null) return null;
  return { payload, issuedAt: verified.issuedAt, expiresAt: verified.expiresAt };
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
