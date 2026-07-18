/**
 * COMMAND_CSRF_GUARD_V1 — Origin/Host validation for state-changing requests (Agent B3).
 *
 * The session cookie is now HMAC-signed and SameSite=Lax (SIGNED_SESSION_COOKIE_V1 /
 * SESSION_ROTATION_AND_REVOCATION_V1). SameSite=Lax stops the cookie riding along on most
 * cross-site sub-requests, which MITIGATES CSRF — but it does not fully eliminate it:
 * top-level navigations, some legacy/edge browser behaviours, and `SameSite`-unaware clients
 * can still let a cross-site actor drive a state-changing request while the victim's cookie is
 * attached. This module adds the standard second line of defence: for any state-changing HTTP
 * method, require a request-supplied Origin (or, absent that, a Referer) whose origin actually
 * matches the host being requested (or an explicit allow-list), and refuse the request otherwise.
 *
 * Design rules (kept deliberately strict — this is a security boundary):
 *   - Only POST/PUT/PATCH/DELETE are guarded. GET/HEAD/OPTIONS are, by contract, non-mutating
 *     (and OPTIONS is the CORS pre-flight) so they are exempt and always pass.
 *   - The declared origin is taken ONLY from the Origin header, falling back to the Referer's
 *     origin when Origin is absent. A request/body field is NEVER trusted for this — an attacker
 *     fully controls the body, so a body-derived "origin" would defeat the whole check.
 *   - A missing/unparseable/opaque ("null") Origin AND Referer on a mutating request fails closed
 *     (treated as cross-origin) rather than being waved through.
 *   - Same-host is allowed by default (the declared origin targets the very host being requested);
 *     additional full origins may be allow-listed (e.g. a separate first-party front-end domain)
 *     via APP_ALLOWED_ORIGINS.
 *
 * Pure and edge-safe: no filesystem, no crypto, only the standard URL parser, the request headers,
 * and (for the env helper) process.env — so it runs unchanged in the Next.js middleware runtime.
 */

/** The HTTP methods that can change server state and therefore require an origin check. */
const STATE_CHANGING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True for POST/PUT/PATCH/DELETE (case-insensitive); false for GET/HEAD/OPTIONS and anything else. */
export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/**
 * The minimal request shape the guard needs. Both the web-standard `Request` and Next.js's
 * `NextRequest` satisfy this structurally, so the same function serves middleware and unit tests.
 */
export interface OriginCheckableRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

export interface SameOriginOptions {
  /** Extra full origins (e.g. "https://app.example.com") that are trusted in addition to same-host. */
  readonly allowedOrigins?: readonly string[];
}

interface NormalizedOrigin {
  /** Lower-cased scheme+host+port, e.g. "https://app.example.com". */
  readonly origin: string;
  /** Lower-cased host[:port], e.g. "app.example.com" or "localhost:3000". */
  readonly host: string;
}

/**
 * Parses an Origin/Referer/allow-list value into its normalized origin+host, or null when it is
 * absent, blank, the opaque "null" origin, or otherwise unparseable. The opaque "null" origin
 * (sandboxed iframes, some cross-scheme redirects, data: URLs) is explicitly NOT same-origin and
 * must never satisfy the guard.
 */
function normalizeOrigin(value: string | null | undefined): NormalizedOrigin | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  try {
    const parsed = new URL(trimmed);
    return { origin: parsed.origin.toLowerCase(), host: parsed.host.toLowerCase() };
  } catch {
    return null;
  }
}

/** First comma-separated token of a header value, trimmed; null when absent/blank. */
function firstHeaderValue(raw: string | null): string | null {
  if (raw === null) return null;
  const first = raw.split(",")[0];
  if (first === undefined) return null;
  const trimmed = first.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The host this request is actually targeting: `x-forwarded-host` (proxy-aware) first, then the
 * `Host` header, finally the host embedded in the request URL. Lower-cased; null only when none
 * of those yield a parseable host.
 */
function requestTargetHost(request: OriginCheckableRequest): string | null {
  const forwarded = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwarded !== null) return forwarded.toLowerCase();

  const host = firstHeaderValue(request.headers.get("host"));
  if (host !== null) return host.toLowerCase();

  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a request may be treated as same-origin for the purposes of CSRF protection.
 *
 *   - Non-mutating methods (GET/HEAD/OPTIONS) are exempt and always return true.
 *   - A mutating method must carry an Origin (or, failing that, a Referer) whose origin matches the
 *     host being requested OR an entry in `allowedOrigins`. Anything else — mismatched origin, or a
 *     missing/opaque origin — returns false (cross-origin / fail-closed).
 */
export function isSameOriginRequest(
  request: OriginCheckableRequest,
  options: SameOriginOptions = {},
): boolean {
  if (!isStateChangingMethod(request.method)) {
    return true;
  }

  const candidate =
    normalizeOrigin(request.headers.get("origin")) ??
    normalizeOrigin(request.headers.get("referer"));
  if (candidate === null) {
    // Mutating request with no usable Origin/Referer: cannot prove same-origin -> reject.
    return false;
  }

  const targetHost = requestTargetHost(request);
  if (targetHost !== null && candidate.host === targetHost) {
    return true;
  }

  for (const allowed of options.allowedOrigins ?? []) {
    const normalized = normalizeOrigin(allowed);
    if (normalized !== null && normalized.origin === candidate.origin) {
      return true;
    }
  }

  return false;
}

/** Env var carrying a comma-separated allow-list of extra trusted origins. */
const ALLOWED_ORIGINS_ENV_VAR = "APP_ALLOWED_ORIGINS";

/**
 * Reads the additional trusted origins from APP_ALLOWED_ORIGINS (comma-separated). Same-host is
 * always trusted implicitly by isSameOriginRequest; this only supplies EXTRA cross-host origins.
 * Returns an empty list when the var is unset/blank.
 */
export function allowedOriginsFromEnv(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const raw = env[ALLOWED_ORIGINS_ENV_VAR];
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
