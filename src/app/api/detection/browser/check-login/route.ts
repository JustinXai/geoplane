import { NextRequest, NextResponse } from "next/server";
import { getAuthRuntime } from "@/runtime/auth/runtime-context";
import { getWorkerSession } from "@/lib/probe-worker/manager";
import { toHttpResponse } from "@/runtime/auth/http";
import { apiErr } from "@/runtime/api-contracts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  let body: { platform?: string; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, projectId } = body;
  const safePlatform = platform ?? "";
  const safeProjectId = projectId ?? "";

  const result = await rt.db.query<{ worker_session_id: string }>(
    `SELECT worker_session_id FROM platform_connection 
     WHERE project_id = $1 AND platform = $2`,
    [safeProjectId, safePlatform]
  );

  const conn = result.rows[0];
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 404 });

  try {
    const worker = await getWorkerSession(conn.worker_session_id);
    const checkResult = await worker.send({ type: "CHECK_LOGIN" }) as { status: string };
    
    await rt.db.query(
      `UPDATE platform_connection 
       SET status = $1, updated_at = NOW(), last_checked_at = NOW()
       WHERE project_id = $2 AND platform = $3`,
      [checkResult.status, safeProjectId, safePlatform]
    );

    return NextResponse.json({ status: checkResult.status });
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Check failed" 
    }, { status: 500 });
  }
}
