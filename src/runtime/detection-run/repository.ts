import type { Queryable } from "../../persistence/database-port.js";
import type {
  DetectionRun,
  DetectionTask,
  DetectionRunStatus,
  DetectionTaskStatus,
} from "./contracts.js";

interface DetectionRunRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  name: string;
  status: DetectionRunStatus;
  questions: string[];
  platforms: string[];
  started_at: Date | null;
  completed_at: Date | null;
  created_by_user_id: string;
  created_at: Date;
}

interface DetectionTaskRow {
  id: string;
  run_id: string;
  platform: string;
  question: string;
  status: DetectionTaskStatus;
  answer_text: string | null;
  failure_code: string | null;
  failure_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

function mapRunRow(row: DetectionRunRow): DetectionRun {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    questions: row.questions,
    platforms: row.platforms,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapTaskRow(row: DetectionTaskRow): DetectionTask {
  return {
    id: row.id,
    runId: row.run_id,
    platform: row.platform,
    question: row.question,
    status: row.status,
    answerText: row.answer_text,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface DetectionRunRepository {
  create(run: DetectionRun): Promise<DetectionRun>;
  getById(id: string): Promise<DetectionRun | null>;
  updateStatus(id: string, status: DetectionRunStatus, startedAt?: string, completedAt?: string): Promise<DetectionRun>;
  listByProject(clientOrganizationId: string, projectId: string): Promise<DetectionRun[]>;
  listAll(clientOrganizationId: string): Promise<DetectionRun[]>;
}

export interface DetectionTaskRepository {
  create(task: DetectionTask): Promise<DetectionTask>;
  getById(id: string): Promise<DetectionTask | null>;
  update(task: DetectionTask): Promise<DetectionTask>;
  listByRunId(runId: string): Promise<DetectionTask[]>;
}

export class PgDetectionRunRepository implements DetectionRunRepository {
  constructor(private readonly db: Queryable) {}

  async create(run: DetectionRun): Promise<DetectionRun> {
    const result = await this.db.query<DetectionRunRow>(
      `INSERT INTO detection_run
       (id, client_organization_id, project_id, name, status, questions, platforms,
        started_at, completed_at, created_by_user_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        run.id, run.clientOrganizationId, run.projectId, run.name, run.status,
        JSON.stringify(run.questions), JSON.stringify(run.platforms), run.startedAt, run.completedAt,
        run.createdByUserId, run.createdAt,
      ],
    );
    const row = result.rows[0] as DetectionRunRow | undefined;
    if (!row) throw new Error("detection_run insert returned no row");
    return mapRunRow(row);
  }

  async getById(id: string): Promise<DetectionRun | null> {
    const result = await this.db.query<DetectionRunRow>(
      "SELECT * FROM detection_run WHERE id = $1", [id],
    );
    if (result.rows.length === 0) return null;
    return mapRunRow(result.rows[0] as DetectionRunRow);
  }

  async updateStatus(
    id: string,
    status: DetectionRunStatus,
    startedAt?: string,
    completedAt?: string,
  ): Promise<DetectionRun> {
    const result = await this.db.query<DetectionRunRow>(
      `UPDATE detection_run
       SET status = $2, started_at = COALESCE($3, started_at), completed_at = COALESCE($4, completed_at)
       WHERE id = $1 RETURNING *`,
      [id, status, startedAt ?? null, completedAt ?? null],
    );
    const row = result.rows[0] as DetectionRunRow | undefined;
    if (!row) throw new Error("detection_run update returned no row");
    return mapRunRow(row);
  }

  async listByProject(clientOrganizationId: string, projectId: string): Promise<DetectionRun[]> {
    const result = await this.db.query<DetectionRunRow>(
      `SELECT * FROM detection_run
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY created_at DESC`,
      [clientOrganizationId, projectId],
    );
    return result.rows.map(mapRunRow);
  }

  async listAll(clientOrganizationId: string): Promise<DetectionRun[]> {
    const result = await this.db.query<DetectionRunRow>(
      `SELECT * FROM detection_run
       WHERE client_organization_id = $1
       ORDER BY created_at DESC`,
      [clientOrganizationId],
    );
    return result.rows.map(mapRunRow);
  }
}

export class PgDetectionTaskRepository implements DetectionTaskRepository {
  constructor(private readonly db: Queryable) {}

  async create(task: DetectionTask): Promise<DetectionTask> {
    const result = await this.db.query<DetectionTaskRow>(
      `INSERT INTO detection_task
       (id, run_id, platform, question, status, answer_text, failure_code,
        failure_message, started_at, completed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        task.id, task.runId, task.platform, task.question, task.status,
        task.answerText, task.failureCode, task.failureMessage,
        task.startedAt, task.completedAt, task.createdAt,
      ],
    );
    const row = result.rows[0] as DetectionTaskRow | undefined;
    if (!row) throw new Error("detection_task insert returned no row");
    return mapTaskRow(row);
  }

  async getById(id: string): Promise<DetectionTask | null> {
    const result = await this.db.query<DetectionTaskRow>(
      "SELECT * FROM detection_task WHERE id = $1", [id],
    );
    if (result.rows.length === 0) return null;
    return mapTaskRow(result.rows[0] as DetectionTaskRow);
  }

  async update(task: DetectionTask): Promise<DetectionTask> {
    const result = await this.db.query<DetectionTaskRow>(
      `UPDATE detection_task
       SET status = $2, answer_text = $3, failure_code = $4, failure_message = $5,
           started_at = COALESCE($6, started_at), completed_at = COALESCE($7, completed_at)
       WHERE id = $1 RETURNING *`,
      [
        task.id, task.status, task.answerText, task.failureCode, task.failureMessage,
        task.startedAt, task.completedAt,
      ],
    );
    const row = result.rows[0] as DetectionTaskRow | undefined;
    if (!row) throw new Error("detection_task update returned no row");
    return mapTaskRow(row);
  }

  async listByRunId(runId: string): Promise<DetectionTask[]> {
    const result = await this.db.query<DetectionTaskRow>(
      "SELECT * FROM detection_task WHERE run_id = $1 ORDER BY created_at ASC",
      [runId],
    );
    return result.rows.map(mapTaskRow);
  }
}
