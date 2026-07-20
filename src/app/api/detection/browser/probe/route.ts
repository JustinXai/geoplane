import { NextRequest, NextResponse } from "next/server";
import { getAuthRuntime } from "@/runtime/auth/runtime-context";
import { getWorkerSession } from "@/lib/probe-worker/manager";
import { randomUUID } from "node:crypto";
import { PgDetectionTaskRepository } from "@/runtime/detection-run/repository";
import { toHttpResponse } from "@/runtime/auth/http";
import { apiErr } from "@/runtime/api-contracts";
import type { DetectionTask, DetectionTaskStatus } from "@/runtime/detection-run/contracts";

export const dynamic = "force-dynamic";

async function updateTask(
  taskRepo: PgDetectionTaskRepository,
  taskId: string,
  updates: Partial<DetectionTask>
): Promise<void> {
  const existing = await taskRepo.getById(taskId);
  if (existing) {
    await taskRepo.update({ ...existing, ...updates });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  let body: { platform?: string; projectId?: string; taskId?: string; question?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, projectId, taskId, question } = body;

  if (!["DOUBAO", "DEEPSEEK"].includes(platform ?? "")) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const safePlatform = platform ?? "";
  const safeProjectId = projectId ?? "";

  const connResult = await rt.db.query<{ worker_session_id: string; status: string }>(
    `SELECT worker_session_id, status FROM platform_connection 
     WHERE project_id = $1 AND platform = $2`,
    [safeProjectId, safePlatform]
  );

  const conn = connResult.rows[0];
  if (!conn || conn.status !== "READY") {
    return NextResponse.json({ error: "Platform not connected or not ready" }, { status: 400 });
  }

  const taskRepo = new PgDetectionTaskRepository(rt.db);

  try {
    const worker = await getWorkerSession(conn.worker_session_id);
    
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "RUNNING",
        startedAt: new Date().toISOString(),
      });
    }

    const result = await worker.send({ type: "PROBE", question }) as { 
      answer?: string; 
      message?: string;
      type: string;
    };

    if (result.type === "PROBE_ERROR") {
      if (taskId) {
        await updateTask(taskRepo, taskId, {
          status: "FAILED",
          failureCode: "PROBE_ERROR",
          failureMessage: result.message ?? "Probe failed",
          completedAt: new Date().toISOString(),
        });
      }
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    const answer = result.answer ?? "";
    
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "SUCCEEDED",
        answerText: answer,
        completedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ answer, status: "COMPLETED" });
  } catch (err) {
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "FAILED",
        failureCode: "EXCEPTION",
        failureMessage: err instanceof Error ? err.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Probe failed" 
    }, { status: 500 });
  }
}
