/**
 * COMMAND_CSRF_GUARD_V1 (Agent B3) — Origin/Host validation + CSRF protection for state-changing
 * requests. Two layers of assertions:
 *
 *   1. Unit: `isSameOriginRequest` / `allowedOriginsFromEnv` decide same-origin vs cross-origin
 *      purely from method + Origin/Referer/Host, never from a body field.
 *   2. Middleware: the real `middleware()` refuses a cross-origin / origin-less mutating request
 *      with 403 BEFORE any handler, exempts GET, and still enforces the pre-existing role-surface
 *      routing (unauthenticated /app -> 302 redirect; cross-role -> 403) unchanged.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  allowedOriginsFromEnv,
  isSameOriginRequest,
  isStateChangingMethod,
  type OriginCheckableRequest,
} from "../../../src/lib/request-origin.js";
import { middleware } from "../../../middleware.js";
import {
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  type AcceptanceSessionCookiePayload,
} from "../../../src/lib/session-cookie.js";

// ---------------------------------------------------------------------------
// Unit-level: isSameOriginRequest
// ---------------------------------------------------------------------------

/** Builds a minimal request whose target host comes from the URL (Host header left unset). */
function req(opts: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
}): OriginCheckableRequest {
  return {
    method: opts.method,
    url: opts.url ?? "https://app.example.com/api/commands/projects",
    headers: new Headers(opts.headers ?? {}),
  };
}

describe("isStateChangingMethod", () => {
  it("flags POST/PUT/PATCH/DELETE (any case) and exempts GET/HEAD/OPTIONS", () => {
    for (const m of ["POST", "put", "Patch", "DELETE"]) {
      expect(isStateChangingMethod(m)).toBe(true);
    }
    for (const m of ["GET", "head", "OPTIONS"]) {
      expect(isStateChangingMethod(m)).toBe(false);
    }
  });
});

describe("isSameOriginRequest — state-changing methods", () => {
  it("a same-origin POST (Origin host == request host) passes", () => {
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "https://app.example.com/api/commands/projects",
          headers: { origin: "https://app.example.com" },
        }),
      ),
    ).toBe(true);
  });

  it("a cross-origin POST (mismatched Origin) is blocked", () => {
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "https://app.example.com/api/commands/projects",
          headers: { origin: "https://evil.example.com" },
        }),
      ),
    ).toBe(false);
  });

  it("an origin-less POST is blocked (fails closed)", () => {
    expect(
      isSameOriginRequest(req({ method: "POST", url: "https://app.example.com/api/x" })),
    ).toBe(false);
  });

  it("an opaque 'null' Origin on a POST is blocked", () => {
    expect(
      isSameOriginRequest(
        req({ method: "POST", url: "https://app.example.com/api/x", headers: { origin: "null" } }),
      ),
    ).toBe(false);
  });

  it("falls back to the Referer's origin when Origin is absent", () => {
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "https://app.example.com/api/x",
          headers: { referer: "https://app.example.com/app/dashboard" },
        }),
      ),
    ).toBe(true);
    // A cross-site Referer is still rejected.
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "https://app.example.com/api/x",
          headers: { referer: "https://evil.example.com/attack" },
        }),
      ),
    ).toBe(false);
  });

  it("honours an allow-listed extra origin (different host) via options", () => {
    const request = req({
      method: "POST",
      url: "https://app.example.com/api/x",
      headers: { origin: "https://partner.example.com" },
    });
    expect(isSameOriginRequest(request)).toBe(false);
    expect(
      isSameOriginRequest(request, { allowedOrigins: ["https://partner.example.com"] }),
    ).toBe(true);
  });

  it("respects an x-forwarded-host proxy header for the target host", () => {
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "http://internal-pod:3000/api/x",
          headers: {
            origin: "https://app.example.com",
            "x-forwarded-host": "app.example.com",
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not trust a body-style field — only Origin/Referer/Host decide", () => {
    // A crafted request that claims same-origin via an arbitrary header must still be rejected;
    // the guard only consults Origin, Referer and the request host.
    expect(
      isSameOriginRequest(
        req({
          method: "POST",
          url: "https://app.example.com/api/x",
          headers: { origin: "https://evil.example.com", "x-claimed-origin": "https://app.example.com" },
        }),
      ),
    ).toBe(false);
  });
});

describe("isSameOriginRequest — non-mutating methods are exempt", () => {
  it("GET/HEAD/OPTIONS pass even with a cross-site or missing Origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        isSameOriginRequest(
          req({ method, url: "https://app.example.com/api/x", headers: { origin: "https://evil.example.com" } }),
        ),
      ).toBe(true);
      expect(isSameOriginRequest(req({ method, url: "https://app.example.com/api/x" }))).toBe(true);
    }
  });
});

describe("allowedOriginsFromEnv", () => {
  it("parses a comma-separated list, trims blanks, and defaults to empty", () => {
    expect(allowedOriginsFromEnv({ APP_ALLOWED_ORIGINS: "https://a.example.com, https://b.example.com ,, " }))
      .toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(allowedOriginsFromEnv({})).toEqual([]);
    expect(allowedOriginsFromEnv({ APP_ALLOWED_ORIGINS: "   " })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Middleware-level: real middleware() over constructed NextRequests
// ---------------------------------------------------------------------------

const CSRF_403_MARKER = "CSRF_ORIGIN_REJECTED";

function mkNextRequest(opts: {
  method: string;
  path: string;
  origin?: string;
  cookie?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  return new NextRequest(`http://localhost:3000${opts.path}`, { method: opts.method, headers });
}

const CLIENT_OWNER_PAYLOAD: AcceptanceSessionCookiePayload = {
  actorUserId: "user_client_owner",
  role: "CLIENT_OWNER",
  organizationId: "org_client_1",
  organizationType: "CLIENT",
  activeClientOrganizationId: "org_client_1",
};

function clientOwnerCookie(): string {
  return `${SESSION_COOKIE_NAME}=${encodeSessionCookie(CLIENT_OWNER_PAYLOAD)}`;
}

describe("middleware — CSRF/Origin guard on state-changing requests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets a same-origin POST to /api/** through the guard", async () => {
    const res = middleware(
      mkNextRequest({ method: "POST", path: "/api/commands/projects", origin: "http://localhost:3000" }),
    );
    expect(res.status).not.toBe(403);
    // A guard-passing /api request continues to the handler (NextResponse.next()).
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("blocks a cross-origin POST to /api/** with a 403 CSRF response", async () => {
    const res = middleware(
      mkNextRequest({ method: "POST", path: "/api/commands/projects", origin: "http://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(CSRF_403_MARKER);
  });

  it("blocks an origin-less POST to /api/** with a 403", async () => {
    const res = middleware(mkNextRequest({ method: "POST", path: "/api/commands/projects" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(CSRF_403_MARKER);
  });

  it("blocks a cross-origin POST to a protected surface too (guard is not /api-only)", async () => {
    const res = middleware(
      mkNextRequest({ method: "POST", path: "/app/settings", origin: "http://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(CSRF_403_MARKER);
  });

  it("exempts a GET (read/health route) from the CSRF guard", () => {
    const res = middleware(mkNextRequest({ method: "GET", path: "/api/health/ready" }));
    expect(res.status).not.toBe(403);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes a cross-host POST when its origin is APP_ALLOWED_ORIGINS-allow-listed", () => {
    vi.stubEnv("APP_ALLOWED_ORIGINS", "https://trusted-partner.example.com");
    const res = middleware(
      mkNextRequest({
        method: "POST",
        path: "/api/commands/projects",
        origin: "https://trusted-partner.example.com",
      }),
    );
    expect(res.status).not.toBe(403);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("middleware — existing role-surface routing is intact", () => {
  it("redirects an unauthenticated GET /app to /login (302)", () => {
    const res = middleware(mkNextRequest({ method: "GET", path: "/app/dashboard" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("blocks a cross-role GET (CLIENT_OWNER -> /agency) with a role 403, not a CSRF 403", async () => {
    const res = middleware(
      mkNextRequest({ method: "GET", path: "/agency/clients", cookie: clientOwnerCookie() }),
    );
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain(CSRF_403_MARKER);
    expect(body).toContain("not authorized");
  });

  it("allows a same-role GET (CLIENT_OWNER -> /app) to continue", () => {
    const res = middleware(
      mkNextRequest({ method: "GET", path: "/app/dashboard", cookie: clientOwnerCookie() }),
    );
    expect(res.status).not.toBe(403);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
