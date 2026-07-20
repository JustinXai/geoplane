/**
 * MVP Detection Analysis — PostgreSQL repositories.
 */
import type { DatabasePort, Queryable, SqlParam } from "../../persistence/database-port.js";
import type { DetectionObservation } from "./contracts.js";

// ---------------------------------------------------------------------------
// DetectionObservation (append-only)
// ---------------------------------------------------------------------------

export interface DetectionObservationRepository {
  append(observation: DetectionObservation): Promise<DetectionObservation>;
  listByRun(runId: string): Promise<DetectionObservation[]>;
}

interface DetectionObservationRow {
  id: string;
  detection_task_id: string;
  run_id: string;
  platform: string;
  question: string;
  answer_text: string;
  brand_mentioned: boolean;
  matched_brand_terms: string[];
  brand_mention_count: number;
  completed_at: Date | string;
}

function mapRow(row: DetectionObservationRow): DetectionObservation {
  return {
    id: row.id,
    detectionTaskId: row.detection_task_id,
    runId: row.run_id,
    platform: row.platform,
    question: row.question,
    answerText: row.answer_text,
    brandMentioned: row.brand_mentioned,
    matchedBrandTerms: row.matched_brand_terms ?? [],
    brandMentionCount: row.brand_mention_count,
    completedAt: new Date(row.completed_at).toISOString(),
  };
}

export class PgDetectionObservationRepository implements DetectionObservationRepository {
  constructor(private readonly db: Queryable) {}

  async append(observation: DetectionObservation): Promise<DetectionObservation> {
    const result = await this.db.query<DetectionObservationRow>(
      `INSERT INTO detection_observation
        (id, detection_task_id, run_id, platform, question, answer_text,
         brand_mentioned, matched_brand_terms, brand_mention_count, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        observation.id,
        observation.detectionTaskId,
        observation.runId,
        observation.platform,
        observation.question,
        observation.answerText,
        observation.brandMentioned,
        observation.matchedBrandTerms as unknown as SqlParam,
        observation.brandMentionCount,
        observation.completedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("detection_observation insert returned no row");
    return mapRow(row);
  }

  async listByRun(runId: string): Promise<DetectionObservation[]> {
    const result = await this.db.query<DetectionObservationRow>(
      `SELECT * FROM detection_observation WHERE run_id = $1 ORDER BY completed_at ASC`,
      [runId],
    );
    return result.rows.map(mapRow);
  }
}

// ---------------------------------------------------------------------------
// DetectionTask / DetectionRun (read-only, created by Agent P)
// ---------------------------------------------------------------------------

export interface DetectionTask {
  readonly id: string;
  readonly runId: string;
  readonly platform: string;
  readonly question: string;
  readonly answerText: string | null;
}

export async function listDetectionTasksByRun(
  db: Queryable,
  runId: string,
): Promise<DetectionTask[]> {
  const result = await db.query<{
    id: string;
    run_id: string;
    platform: string;
    question: string;
    answer_text: string | null;
  }>(
    `SELECT id, run_id, platform, question, answer_text
       FROM detection_task
      WHERE run_id = $1
      ORDER BY id ASC`,
    [runId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    platform: row.platform,
    question: row.question,
    answerText: row.answer_text,
  }));
}

export interface DetectionRun {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly createdAt: string;
}

export async function getDetectionRun(
  db: Queryable,
  runId: string,
): Promise<DetectionRun | null> {
  const result = await db.query<{
    id: string;
    client_organization_id: string;
    project_id: string;
    created_at: Date | string;
  }>(
    `SELECT id, client_organization_id, project_id, created_at
       FROM detection_run
      WHERE id = $1`,
    [runId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        clientOrganizationId: row.client_organization_id,
        projectId: row.project_id,
        createdAt: new Date(row.created_at).toISOString(),
      }
    : null;
}
