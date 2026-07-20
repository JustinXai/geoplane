/**
 * Domestic AI detection run & task runtime contracts.
 * Mirrors the detection_run / detection_task DB tables created by
 * migrations/0019_domestic_detection_run.sql.
 */

export type DetectionRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "MANUAL_REQUIRED";
export type DetectionTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "MANUAL_REQUIRED";
export type DetectionPlatformCode = "DOUBAO" | "QWEN" | "DEEPSEEK" | "YUANBAO";

export interface DetectionRun {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: DetectionRunStatus;
  readonly questions: readonly string[];
  readonly platforms: readonly string[];
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

export interface DetectionTask {
  readonly id: string;
  readonly runId: string;
  readonly platform: string;
  readonly question: string;
  readonly status: DetectionTaskStatus;
  readonly answerText: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export interface DetectionRunCreate {
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly name: string;
  readonly questions: readonly string[];
  readonly platforms: readonly string[];
  readonly createdByUserId: string;
}

export type DetectionRunWithTasks = DetectionRun & { readonly tasks: readonly DetectionTask[] };
