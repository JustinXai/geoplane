import { randomUUID } from "node:crypto";
import type { Queryable } from "../../persistence/database-port.js";
import { getProbePlatform, type ProbePlatformCode } from "./registry.js";

export const PROBE_FAILURE_CODES = [
  "MANUAL_ACCESS_UNAVAILABLE",
  "ANSWER_NOT_RETURNED",
  "CAPTURE_INCOMPLETE",
  "OTHER",
] as const;
export type ProbeFailureCode = (typeof PROBE_FAILURE_CODES)[number];
export type ProbeOutcome = "ANSWERED" | "FAILED";

export interface RawProbeResult {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly platform: ProbePlatformCode;
  readonly collectionMode: "MANUAL_SAMPLE";
  readonly question: string;
  readonly outcome: ProbeOutcome;
  readonly answerText: string | null;
  readonly screenshotReference: string | null;
  readonly failureCode: ProbeFailureCode | null;
  readonly failureMessage: string | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly recordedByUserId: string;
}

export interface ManualProbeSampleInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly platform: string;
  readonly collectionMode: "MANUAL_SAMPLE";
  readonly question: string;
  readonly outcome: ProbeOutcome;
  readonly answerText?: string | null;
  /** Opaque reference to a separately governed screenshot; never raw image bytes. */
  readonly screenshotReference?: string | null;
  readonly failureCode?: ProbeFailureCode | null;
  readonly failureMessage?: string | null;
  readonly observedAt: string;
}

export interface RawProbeResultRepository {
  append(result: RawProbeResult): Promise<RawProbeResult>;
  listByProject(clientOrganizationId: string, projectId: string): Promise<RawProbeResult[]>;
}

export class ProbeValidationError extends Error {}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function validateManualProbeSample(input: ManualProbeSampleInput): void {
  const platform = getProbePlatform(input.platform);
  if (!platform || platform.status !== "ACTIVE") {
    throw new ProbeValidationError("platform must be an active manual-sample platform");
  }
  if (input.collectionMode !== "MANUAL_SAMPLE") {
    throw new ProbeValidationError("only MANUAL_SAMPLE collection is permitted");
  }
  if (!text(input.clientOrganizationId) || !text(input.projectId) || !text(input.question)) {
    throw new ProbeValidationError("clientOrganizationId, projectId and question are required");
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new ProbeValidationError("observedAt must be an ISO-compatible timestamp");
  }
  if (input.outcome === "ANSWERED") {
    if (!text(input.answerText) || input.failureCode || text(input.failureMessage)) {
      throw new ProbeValidationError("ANSWERED requires answerText and forbids failure fields");
    }
  } else if (input.outcome === "FAILED") {
    if (!input.failureCode || !PROBE_FAILURE_CODES.includes(input.failureCode) || text(input.answerText)) {
      throw new ProbeValidationError("FAILED requires a supported failureCode and forbids answerText");
    }
  } else {
    throw new ProbeValidationError("outcome must be ANSWERED or FAILED");
  }
}

export class ManualProbeService {
  constructor(
    private readonly repository: RawProbeResultRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly nextId: () => string = randomUUID,
  ) {}

  async record(input: ManualProbeSampleInput, recordedByUserId: string): Promise<RawProbeResult> {
    validateManualProbeSample(input);
    const result: RawProbeResult = {
      id: this.nextId(),
      clientOrganizationId: input.clientOrganizationId.trim(),
      projectId: input.projectId.trim(),
      platform: input.platform as ProbePlatformCode,
      collectionMode: "MANUAL_SAMPLE",
      question: input.question.trim(),
      outcome: input.outcome,
      answerText: input.outcome === "ANSWERED" ? text(input.answerText) : null,
      screenshotReference: text(input.screenshotReference),
      failureCode: input.outcome === "FAILED" ? input.failureCode ?? null : null,
      failureMessage: input.outcome === "FAILED" ? text(input.failureMessage) : null,
      observedAt: new Date(input.observedAt).toISOString(),
      recordedAt: this.now().toISOString(),
      recordedByUserId,
    };
    return this.repository.append(result);
  }
}

interface ProbeRow {
  id: string; client_organization_id: string; project_id: string; platform: ProbePlatformCode;
  collection_mode: "MANUAL_SAMPLE"; question: string; outcome: ProbeOutcome;
  answer_text: string | null; screenshot_reference: string | null;
  failure_code: ProbeFailureCode | null; failure_message: string | null;
  observed_at: Date | string; recorded_at: Date | string; recorded_by_user_id: string;
}

function mapRow(row: ProbeRow): RawProbeResult {
  return {
    id: row.id, clientOrganizationId: row.client_organization_id, projectId: row.project_id,
    platform: row.platform, collectionMode: row.collection_mode, question: row.question,
    outcome: row.outcome, answerText: row.answer_text, screenshotReference: row.screenshot_reference,
    failureCode: row.failure_code, failureMessage: row.failure_message,
    observedAt: new Date(row.observed_at).toISOString(), recordedAt: new Date(row.recorded_at).toISOString(),
    recordedByUserId: row.recorded_by_user_id,
  };
}

export class PgRawProbeResultRepository implements RawProbeResultRepository {
  constructor(private readonly db: Queryable) {}
  async append(value: RawProbeResult): Promise<RawProbeResult> {
    const result = await this.db.query<ProbeRow>(
      `INSERT INTO raw_probe_result
       (id, client_organization_id, project_id, platform, collection_mode, question, outcome,
        answer_text, screenshot_reference, failure_code, failure_message, observed_at, recorded_at, recorded_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [value.id, value.clientOrganizationId, value.projectId, value.platform, value.collectionMode,
       value.question, value.outcome, value.answerText, value.screenshotReference, value.failureCode,
       value.failureMessage, value.observedAt, value.recordedAt, value.recordedByUserId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("raw probe result insert returned no row");
    return mapRow(row);
  }
  async listByProject(clientOrganizationId: string, projectId: string): Promise<RawProbeResult[]> {
    const result = await this.db.query<ProbeRow>(
      `SELECT * FROM raw_probe_result WHERE client_organization_id=$1 AND project_id=$2
       ORDER BY observed_at ASC, recorded_at ASC, id ASC`, [clientOrganizationId, projectId],
    );
    return result.rows.map(mapRow);
  }
}
