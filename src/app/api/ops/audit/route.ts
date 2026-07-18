/**
 * GET /api/ops/audit — the Ops workspace's recent cross-tenant audit trail as AuditEventViewV1[],
 * newest first. PLATFORM_SUPER_ADMIN only; any other role -> 403.
 *
 * BUSINESS_COMMAND_API_V1 (Agent C — batch 1). Role is derived from the resolved session.
 * Accepts an optional ?limit (1..500, default 100).
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import { listRecentAuditViews } from "../../../../runtime/commands/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(n, 500);
}

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }
  if (session.role !== "PLATFORM_SUPER_ADMIN") {
    return toHttpResponse(
      apiErr("FORBIDDEN", "Only a platform super admin may read the audit trail."),
    );
  }

  const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
  const events = await listRecentAuditViews(rt.db, limit);
  return toHttpResponse(apiOk(events));
}
