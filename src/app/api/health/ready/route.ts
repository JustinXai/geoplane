/**
 * GET /api/health/ready — readiness probe.
 *
 * Returns 200 when ALL blocker checks pass:
 *   { database reachable, migrations current (0006), required env present, file storage reachable }
 * plus the provider-flag state reported. Returns 503 with a per-check breakdown otherwise.
 *
 * All logic lives in src/runtime/observability/readiness.ts (a route module may only export the
 * framework's recognised names). The body carries only check names / statuses / secret-free detail
 * strings — never a DB URL, signing key, or any other secret.
 *
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1).
 */
import { evaluateReadiness } from "../../../../runtime/observability/readiness.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { httpStatus, body } = await evaluateReadiness();
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
