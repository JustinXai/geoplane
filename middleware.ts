/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation" -
 *   "No query, migration, or fixture may assume a single-tenant world", "front-end hiding a
 *   control is not a substitute for backend permission verification"), src/lib/workspace-nav.ts
 *   (assertSurfaceIsolatedLinks - the presentation-layer isolation this middleware makes real
 *   at the HTTP layer instead), src/lib/session-cookie.ts (the session shape this file checks)
 * reconstruction_reason: net-new acceptance-phase file (REBUILD_INTEGRATION_ACCEPTANCE_V1,
 *   sections 7-8: "/app/* 角色边界有效" / "/agency/* 角色边界有效" / "/ops/* 角色边界有效",
 *   "未登录访问受保护页面被拒绝", "Client 访问 Agency 被拒绝", "Agency 访问 Ops 被拒绝") -
 *   every C1-C6 checkpoint was explicitly presentation-only with zero auth wiring (see
 *   src/app/app/layout.tsx's own TODO comments); this is the first real enforcement.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Real Next.js middleware, evaluated on every request to /app/*, /agency/*, /ops/* before
 * any page component runs. See src/lib/session-cookie.ts's header for the explicit scope
 * limitation: the session cookie this checks is NOT cryptographically signed and is not a
 * real authentication system - what this middleware DOES prove for real is that the
 * client/agency/ops role-boundary rule is enforced as a genuine HTTP-layer gate (a 403/
 * redirect an actual request receives), not merely a UI convention that a determined caller
 * could bypass by hitting the route directly - which is exactly what SYSTEM_INVARIANTS_V1's
 * "front-end hiding a control is not a substitute for backend permission verification" rule
 * requires, and exactly what section 8's HTTP smoke test (as opposed to build-time route
 * generation, section 7) is meant to exercise.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, allowedSurfaceForRole, decodeSessionCookie } from "./src/lib/session-cookie";
import { allowedOriginsFromEnv, isSameOriginRequest, isStateChangingMethod } from "./src/lib/request-origin";

const PROTECTED_SURFACES = ["app", "agency", "ops"] as const;
const INDEPENDENT_DETECTION_PROTOTYPE_PATHS = ["/app/ai-results", "/agency/manual-probe", "/ops/probes"] as const;
type ProtectedSurface = (typeof PROTECTED_SURFACES)[number];

function surfaceForPath(pathname: string): ProtectedSurface | null {
  const segment = pathname.split("/")[1];
  if (segment === undefined) return null;
  return (PROTECTED_SURFACES as readonly string[]).includes(segment) ? (segment as ProtectedSurface) : null;
}

function isIndependentDetectionPrototypePath(pathname: string): boolean {
  return (INDEPENDENT_DETECTION_PROTOTYPE_PATHS as readonly string[]).includes(pathname) ||
    pathname === "/api/probes" || pathname.startsWith("/api/probes/");
}

/**
 * COMMAND_CSRF_GUARD_V1 (Agent B3): refuse any state-changing (POST/PUT/PATCH/DELETE) request
 * whose Origin/Referer does not match this host (or an APP_ALLOWED_ORIGINS entry) BEFORE the route
 * handler runs. The signed SameSite=Lax session cookie mitigates but does not fully eliminate CSRF,
 * so this is the central, handler-independent second line of defence. GET/HEAD/OPTIONS are exempt,
 * leaving read/health routes and the role-surface redirects below entirely untouched. Returns a
 * 403 (with a clear JSON body) to block, or null to let the request continue.
 */
function csrfOriginGuard(request: NextRequest): NextResponse | null {
  if (!isStateChangingMethod(request.method)) {
    return null;
  }
  if (isSameOriginRequest(request, { allowedOrigins: allowedOriginsFromEnv() })) {
    return null;
  }
  return new NextResponse(
    JSON.stringify({
      error: "CSRF_ORIGIN_REJECTED",
      message:
        "This state-changing request was blocked: its Origin/Referer does not match an allowed origin.",
    }),
    { status: 403, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

export function middleware(request: NextRequest) {
  // CSRF/Origin guard runs first, for EVERY matched request (/api/* and the protected surfaces),
  // so a cross-origin or origin-less mutating request is refused before any handler or role check.
  const csrfBlock = csrfOriginGuard(request);
  if (csrfBlock !== null) {
    return csrfBlock;
  }

  const surface = surfaceForPath(request.nextUrl.pathname);
  if (
    isIndependentDetectionPrototypePath(request.nextUrl.pathname) &&
    process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED?.trim().toUpperCase() !== "TRUE"
  ) {
    return new NextResponse("Not Found", { status: 404 });
  }
  if (surface === null) {
    // Not a protected surface (/api read routes, /, /login, static assets, etc.) - no session
    // required. (Mutating /api requests already passed the CSRF guard above.)
    return NextResponse.next();
  }

  const session = decodeSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (session === null) {
    // "未登录访问受保护页面被拒绝" - no valid session at all, redirect to /login.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  const allowedSurface = allowedSurfaceForRole(session.role);
  if (allowedSurface !== surface) {
    // "Client 访问 Agency 被拒绝" / "Agency 访问 Ops 被拒绝" (and every other cross-surface
    // combination, by the same rule, symmetrically) - a real, non-2xx HTTP response, not a
    // client-side redirect a script could ignore.
    return new NextResponse("Forbidden: this role is not authorized for this workspace surface.", {
      status: 403,
    });
  }

  return NextResponse.next();
}

export const config = {
  // Adds /api/* so the CSRF/Origin guard covers every state-changing API route (in addition to the
  // existing role-surface enforcement on /app,/agency,/ops). GET/read requests to these paths pass
  // straight through, so health/read routes are unaffected.
  //
  // NOTE: with a `src/` directory, Next.js loads middleware from `src/middleware.ts`, NOT this
  // root file. `src/middleware.ts` re-exports the `middleware` function below and MUST declare an
  // identical `matcher` inline (Next's static analysis does not follow a re-exported `config`).
  // Keep this list and `src/middleware.ts`'s matcher in sync.
  matcher: ["/app/:path*", "/agency/:path*", "/ops/:path*", "/api/:path*"],
};
