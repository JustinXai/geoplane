/**
 * GET /api/health/live — liveness probe. Always 200 {status:"live"} with NO dependency checks.
 *
 * Liveness answers only "is this process running and able to serve HTTP" — it must never touch
 * the database, env, or any external dependency, so an orchestrator does not kill a healthy pod
 * during a transient dependency blip. Readiness (dependency health) lives at /api/health/ready.
 *
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify({ status: "live" }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
