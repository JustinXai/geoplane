import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../persistence/database-port.js";
import {
  PgDetectionRunRepository,
  PgDetectionTaskRepository,
  type DetectionRunRepository,
  type DetectionTaskRepository,
} from "./repository.js";
import type {
  DetectionRun,
  DetectionTask,
  DetectionRunCreate,
  DetectionRunWithTasks,
  DetectionTaskStatus,
  DetectionRunStatus,
} from "./contracts.js";

export class DetectionRunService {
  private readonly runRepo: DetectionRunRepository;
  private readonly taskRepo: DetectionTaskRepository;
  private readonly now: () => string;

  constructor(
    private readonly db: DatabasePort,
    repositories?: {
      runRepo?: DetectionRunRepository;
      taskRepo?: DetectionTaskRepository;
    },
    now: () => string = () => new Date().toISOString(),
  ) {
    this.runRepo = repositories?.runRepo ?? new PgDetectionRunRepository(db);
    this.taskRepo = repositories?.taskRepo ?? new PgDetectionTaskRepository(db);
    this.now = now;
  }

  async createRun(input: DetectionRunCreate): Promise<DetectionRunWithTasks> {
    return this.db.transaction(async (tx) => {
      const runRepo = new PgDetectionRunRepository(tx);
      const taskRepo = new PgDetectionTaskRepository(tx);

      const createdAt = this.now();
      const run: DetectionRun = {
        id: randomUUID(),
        clientOrganizationId: input.clientOrganizationId,
        projectId: input.projectId,
        name: input.name,
        status: "PENDING",
        questions: input.questions,
        platforms: input.platforms,
        startedAt: null,
        completedAt: null,
        createdByUserId: input.createdByUserId,
        createdAt,
      };

      const createdRun = await runRepo.create(run);

      const tasks: DetectionTask[] = [];
      for (const platform of input.platforms) {
        for (const question of input.questions) {
          const task: DetectionTask = {
            id: randomUUID(),
            runId: createdRun.id,
            platform,
            question,
            status: "PENDING",
            answerText: null,
            failureCode: null,
            failureMessage: null,
            startedAt: null,
            completedAt: null,
            createdAt,
          };
          tasks.push(await taskRepo.create(task));
        }
      }

      return { ...createdRun, tasks };
    });
  }

  async getRun(runId: string): Promise<DetectionRunWithTasks | null> {
    const run = await this.runRepo.getById(runId);
    if (!run) return null;
    const tasks = await this.taskRepo.listByRunId(runId);
    return { ...run, tasks };
  }

  async updateTaskResult(
    taskId: string,
    result: { answerText?: string; failureCode?: string; failureMessage?: string },
    status: DetectionTaskStatus,
  ): Promise<DetectionTask> {
    const existing = await this.taskRepo.getById(taskId);
    if (!existing) {
      throw new Error(`detection task not found: ${taskId}`);
    }

    const updatedTask: DetectionTask = {
      ...existing,
      status,
      answerText: result.answerText ?? existing.answerText,
      failureCode: result.failureCode ?? existing.failureCode,
      failureMessage: result.failureMessage ?? existing.failureMessage,
      startedAt: existing.startedAt ?? this.now(),
      completedAt: status !== "PENDING" && status !== "RUNNING" ? this.now() : existing.completedAt,
    };

    return this.taskRepo.update(updatedTask);
  }

  async finalizeRun(runId: string): Promise<void> {
    const tasks = await this.taskRepo.listByRunId(runId);

    const allManualRequired = tasks.every((t) => t.status === "MANUAL_REQUIRED");
    const allSucceeded = tasks.every((t) => t.status === "SUCCEEDED");
    const anyFailed = tasks.some((t) => t.status === "FAILED");
    const anyManualRequired = tasks.some((t) => t.status === "MANUAL_REQUIRED");
    const anyRunning = tasks.some((t) => t.status === "PENDING" || t.status === "RUNNING");

    let newStatus: DetectionRunStatus;
    if (anyRunning) {
      newStatus = "RUNNING";
    } else if (allManualRequired) {
      newStatus = "MANUAL_REQUIRED";
    } else if (allSucceeded) {
      newStatus = "SUCCEEDED";
    } else if (anyFailed && anyManualRequired) {
      newStatus = "MANUAL_REQUIRED";
    } else if (anyFailed) {
      newStatus = "FAILED";
    } else {
      newStatus = "SUCCEEDED";
    }

    const startedAt = tasks.find((t) => t.startedAt)?.startedAt ?? undefined;
    const isTerminalStatus = (newStatus === "SUCCEEDED" || newStatus === "FAILED" || newStatus === "MANUAL_REQUIRED");
    const completedAt = isTerminalStatus ? this.now() : undefined;

    await this.runRepo.updateStatus(runId, newStatus, startedAt, completedAt);
  }

  async listRuns(clientOrgId: string, projectId: string): Promise<DetectionRun[]> {
    return this.runRepo.listByProject(clientOrgId, projectId);
  }
}
