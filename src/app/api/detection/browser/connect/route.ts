import { NextRequest, NextResponse } from "next/server";
import { getAuthRuntime } from "@/runtime/auth/runtime-context";
import { getWorkerSession } from "@/lib/probe-worker/manager";
import { randomUUID } from "node:crypto";
import { toHttpResponse } from "@/runtime/auth/http";
import { apiErr } from "@/runtime/api-contracts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  let body: { platform?: string; projectId?: string; accountId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, projectId, accountId } = body;

  if (!["DOUBAO", "DEEPSEEK"].includes(platform ?? "")) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const workerSessionId = randomUUID();
  const connectionId = randomUUID();
  const safePlatform = platform ?? "";
  const safeProjectId = projectId ?? "";
  const safeAccountId = accountId ?? "";

  try {
    const worker = await getWorkerSession(workerSessionId);
    await worker.send({ type: "CONNECT", platform: safePlatform });

    await rt.db.query(
      `INSERT INTO platform_connection (id, project_id, account_id, platform, worker_session_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (project_id, platform) DO UPDATE SET
         worker_session_id = $5, status = $6, updated_at = NOW()`,
      [connectionId, safeProjectId, safeAccountId, safePlatform, workerSessionId, "WAITING_FOR_LOGIN"]
    );

    return NextResponse.json({ 
      status: "WAITING_FOR_LOGIN",
      workerSessionId,
      platform: safePlatform,
    });
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Failed to connect" 
    }, { status: 500 });
  }
}
