import { NextRequest, NextResponse } from "next/server";
import { getAuthRuntime } from "@/runtime/auth/runtime-context";
import { getWorkerSession } from "@/lib/probe-worker/manager";
import { PgDetectionTaskRepository } from "@/runtime/detection-run/repository";
import { toHttpResponse } from "@/runtime/auth/http";
import { apiErr } from "@/runtime/api-contracts";
import type { DetectionTask, DetectionTaskStatus } from "@/runtime/detection-run/contracts";

export const dynamic = "force-dynamic";

type ProbeResultStatus = "SUCCEEDED" | "FAILED" | "MANUAL_REQUIRED" | "TIMEOUT";

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

  let body: { 
    platform?: string; 
    projectId?: string; 
    taskId?: string; 
    question?: string;
    maxWaitMs?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { platform, projectId, taskId, question, maxWaitMs } = body;

  if (!["DOUBAO", "DEEPSEEK"].includes(platform ?? "")) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json({ error: "Missing question" }, { status: 400 });
  }

  const safePlatform = platform ?? "";
  const safeProjectId = projectId ?? "";

  const connResult = await rt.db.query<{ 
    worker_session_id: string; 
    status: string;
    account_id: string;
  }>(
    `SELECT worker_session_id, status, account_id FROM platform_connection 
     WHERE project_id = $1 AND platform = $2`,
    [safeProjectId, safePlatform]
  );

  const conn = connResult.rows[0];
  if (!conn) {
    return NextResponse.json({ error: "Platform not connected" }, { status: 400 });
  }

  if (conn.status !== "READY") {
    return NextResponse.json({ 
      error: `Platform not ready: ${conn.status}`,
      status: conn.status 
    }, { status: 400 });
  }

  const taskRepo = new PgDetectionTaskRepository(rt.db);

  try {
    const worker = await getWorkerSession(conn.worker_session_id, {
      accountId: conn.account_id,
      platform: safePlatform,
    });
    
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "RUNNING",
        startedAt: new Date().toISOString(),
      });
    }

    await rt.db.query(
      `UPDATE platform_connection SET status = 'RUNNING', updated_at = NOW() 
       WHERE project_id = $1 AND platform = $2`,
      [safeProjectId, safePlatform]
    );

    const result = await worker.send({ 
      type: "PROBE", 
      question,
      maxWaitMs: maxWaitMs ?? 120000,
    }) as { 
      answer?: string; 
      message?: string;
      type: string;
    };

    let finalStatus: ProbeResultStatus;
    
    if (result.type === "PROBE_COMPLETE" && result.answer) {
      finalStatus = "SUCCEEDED";
      
      if (taskId) {
        await updateTask(taskRepo, taskId, {
          status: "SUCCEEDED",
          answerText: result.answer,
          completedAt: new Date().toISOString(),
        });
      }

      await rt.db.query(
        `UPDATE platform_connection SET status = 'SUCCEEDED', updated_at = NOW() 
         WHERE project_id = $1 AND platform = $2`,
        [safeProjectId, safePlatform]
      );

      return NextResponse.json({ 
        answer: result.answer, 
        status: "COMPLETED" 
      });
    }
    
    if (result.type === "TIMEOUT") {
      finalStatus = "TIMEOUT";
      
      if (taskId) {
        await updateTask(taskRepo, taskId, {
          status: "FAILED",
          failureCode: "TIMEOUT",
          failureMessage: result.message ?? "Probe timeout",
          completedAt: new Date().toISOString(),
        });
      }

      await rt.db.query(
        `UPDATE platform_connection SET status = 'FAILED', updated_at = NOW() 
         WHERE project_id = $1 AND platform = $2`,
        [safeProjectId, safePlatform]
      );

      return NextResponse.json({ 
        error: result.message ?? "Probe timeout",
        status: "TIMEOUT"
      }, { status: 408 });
    }

    if (result.message?.includes("Manual verification")) {
      finalStatus = "MANUAL_REQUIRED";
      
      if (taskId) {
        await updateTask(taskRepo, taskId, {
          status: "FAILED",
          failureCode: "MANUAL_REQUIRED",
          failureMessage: "Manual verification (captcha/scan) required",
          completedAt: new Date().toISOString(),
        });
      }

      await rt.db.query(
        `UPDATE platform_connection SET status = 'MANUAL_REQUIRED', updated_at = NOW() 
         WHERE project_id = $1 AND platform = $2`,
        [safeProjectId, safePlatform]
      );

      return NextResponse.json({ 
        error: "Manual verification required",
        status: "MANUAL_REQUIRED",
        requiresManualAction: true,
      }, { status: 422 });
    }

    finalStatus = "FAILED";
    
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "FAILED",
        failureCode: "PROBE_ERROR",
        failureMessage: result.message ?? "Probe failed",
        completedAt: new Date().toISOString(),
      });
    }

    await rt.db.query(
      `UPDATE platform_connection SET status = 'FAILED', updated_at = NOW() 
       WHERE project_id = $1 AND platform = $2`,
      [safeProjectId, safePlatform]
    );

    return NextResponse.json({ 
      error: result.message ?? "Probe failed",
      status: "FAILED"
    }, { status: 500 });
  } catch (err) {
    if (taskId) {
      await updateTask(taskRepo, taskId, {
        status: "FAILED",
        failureCode: "EXCEPTION",
        failureMessage: err instanceof Error ? err.message : "Unknown error",
        completedAt: new Date().toISOString(),
      });
    }

    await rt.db.query(
      `UPDATE platform_connection SET status = 'FAILED', updated_at = NOW() 
       WHERE project_id = $1 AND platform = $2`,
      [safeProjectId, safePlatform]
    );

    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Probe failed" 
    }, { status: 500 });
  }
}
