#!/usr/bin/env node
/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: middleware.ts, src/lib/session-cookie.ts (this phase's own new
 *   files - section 7), this phase's spec section 8 "真实 Route Smoke Test"
 * reconstruction_reason: net-new acceptance-phase script - no original test source
 *   recoverable, proving code written during this same phase.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Real HTTP smoke test against a running `next start` server (no mocking, no in-process
 * route invocation) - issues actual fetch() requests with real Cookie headers and asserts
 * on the real HTTP status code returned.
 *
 * Route-name note: this phase's spec section 8 names some routes
 * (/app/dashboard, /app/questions, /app/visibility, /agency/clients, /agency/reviews)
 * that do not exist verbatim in this codebase's actual built routes. Rather than silently
 * 404 against a fabricated path, or invent a new route to match the name (section 13 of
 * this same phase's spec explicitly PROHIBITS adding new visibility-monitoring features,
 * which /app/visibility would be), this script maps each named route to the real,
 * already-built route that is its closest conceptual match, and records the mapping
 * explicitly in the output - see ROUTE_NAME_MAPPING below.
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.SMOKE_TEST_BASE_URL ?? "http://localhost:3417";
const SESSION_COOKIE_NAME = "geo_acceptance_session";

function encodeSessionCookie(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const CLIENT_OWNER_SESSION = encodeSessionCookie({
  actorUserId: "user_client_owner",
  role: "CLIENT_OWNER",
  organizationId: "org_client_1",
  organizationType: "CLIENT",
  activeClientOrganizationId: "org_client_1",
});
const AGENCY_OWNER_SESSION = encodeSessionCookie({
  actorUserId: "user_agency_owner",
  role: "AGENCY_OWNER",
  organizationId: "org_agency_1",
  organizationType: "AGENCY",
  activeClientOrganizationId: null,
});
const PLATFORM_ADMIN_SESSION = encodeSessionCookie({
  actorUserId: "user_platform_admin",
  role: "PLATFORM_SUPER_ADMIN",
  organizationId: "org_platform_1",
  organizationType: "PLATFORM",
  activeClientOrganizationId: null,
});

// Spec-named route -> real built route, where they differ. Recorded explicitly rather
// than silently substituted - see file header.
const ROUTE_NAME_MAPPING = {
  "/app/dashboard": "/app",
  "/app/questions": "/app/keywords",
  "/app/visibility": "/app/performance",
  "/agency/clients": "/agency/projects",
  "/agency/reviews": "/agency/review-queue",
};

function resolveRoute(specNamedPath) {
  return ROUTE_NAME_MAPPING[specNamedPath] ?? specNamedPath;
}

const results = [];
let failures = 0;

async function check(label, path, { cookie, expectStatus, expectStatusIn } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = cookie ? { Cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {};
  const response = await fetch(url, { headers, redirect: "manual" });
  const status = response.status;
  const acceptable = expectStatusIn ?? [expectStatus];
  const pass = acceptable.includes(status);
  if (!pass) failures++;
  results.push({ label, path, status, expected: acceptable, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(60)} ${path.padEnd(28)} -> ${status} (expected ${acceptable.join("|")})`);
}

async function main() {
  // Wait for the server to be ready.
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${BASE_URL}/login`);
      if (r.status < 500) break;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }

  console.log("\n=== 1. Legitimate identity returns 200 on its own surface ===");
  for (const path of ["/app", "/app/knowledge", resolveRoute("/app/questions"), "/app/content", "/app/delivery", resolveRoute("/app/visibility")]) {
    await check("CLIENT_OWNER on own /app/* route", path, { cookie: CLIENT_OWNER_SESSION, expectStatus: 200 });
  }
  for (const path of [resolveRoute("/agency/clients"), "/agency/templates", resolveRoute("/agency/reviews")]) {
    await check("AGENCY_OWNER on own /agency/* route", path, { cookie: AGENCY_OWNER_SESSION, expectStatus: 200 });
  }
  for (const path of ["/ops/organizations", "/ops/invitations", "/ops/audit", "/ops/system-health"]) {
    await check("PLATFORM_SUPER_ADMIN on own /ops/* route", path, { cookie: PLATFORM_ADMIN_SESSION, expectStatus: 200 });
  }
  await check("/login is always reachable, no session required", "/login", { expectStatus: 200 });

  console.log("\n=== 2. 未登录访问受保护页面被拒绝 (unauthenticated access to protected pages is denied) ===");
  for (const path of ["/app", "/agency/templates", "/ops/organizations"]) {
    // next start's redirect() responses land as 307/308; a locally-handled middleware
    // redirect is 302 - accept the real range NextResponse.redirect can produce.
    await check("No session -> redirected away from protected route", path, { expectStatusIn: [301, 302, 307, 308] });
  }

  console.log("\n=== 3. Client 访问 Agency 被拒绝 (client accessing agency is denied) ===");
  await check("CLIENT_OWNER session hitting /agency/*", "/agency/templates", { cookie: CLIENT_OWNER_SESSION, expectStatus: 403 });

  console.log("\n=== 4. Agency 访问 Ops 被拒绝 (agency accessing ops is denied) ===");
  await check("AGENCY_OWNER session hitting /ops/*", "/ops/organizations", { cookie: AGENCY_OWNER_SESSION, expectStatus: 403 });

  console.log("\n=== 5. Additional cross-surface combinations (full pairwise matrix, not just the two named above) ===");
  await check("CLIENT_OWNER session hitting /ops/*", "/ops/organizations", { cookie: CLIENT_OWNER_SESSION, expectStatus: 403 });
  await check("AGENCY_OWNER session hitting /app/*", "/app", { cookie: AGENCY_OWNER_SESSION, expectStatus: 403 });
  await check("PLATFORM_SUPER_ADMIN session hitting /app/* (platform admin's home surface is /ops only in this middleware)", "/app", { cookie: PLATFORM_ADMIN_SESSION, expectStatus: 403 });
  await check("PLATFORM_SUPER_ADMIN session hitting /agency/*", "/agency/templates", { cookie: PLATFORM_ADMIN_SESSION, expectStatus: 403 });

  console.log("\n=== 6. Client A 访问 Client B 被拒绝 (see note) ===");
  console.log(
    "NOTE: no route in this codebase accepts a foreign tenant/client-organization id as a\n" +
      "path or query parameter - every /app/* route is implicitly scoped to the current\n" +
      "session's own activeClientOrganizationId, so there is no HTTP endpoint through which\n" +
      "Client A could even attempt to address Client B's data (the isolation is structural,\n" +
      "not just checked-and-denied). This exact scenario IS exercised at the service/read-model\n" +
      "layer, with a real assertion that it throws - see\n" +
      "tests/composition/application-composition-root.test.ts, the third test case.",
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${results.length} total)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
