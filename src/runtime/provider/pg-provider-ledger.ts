/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_EXECUTION_LEDGER_V1 (checkpoint D3 of the
 *   controlled-provider lane) — the durable, tenant+project-scoped sink for the
 *   observability records the D1 boundary defines (records.ts) and the D2
 *   adapter emits (openai-compatible-adapter.ts, via ProviderCallObserver).
 *   Writes append-only rows to migrations/0007_provider_ledger.sql's
 *   `provider_execution` table over the persistence Queryable port.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * ####################################################################### --
 * ## NO SECRET, NO RAW CONTENT, EVER.                                    ## --
 * ####################################################################### --
 * This repository writes ONLY the fields carried by the record types in
 * records.ts — correlation/idempotency ids, tenant/project/brief scope, the
 * model name, the canonical provider identity (closed gateway/model-vendor/
 * protocol enums, identity.ts — never a base URL, endpoint host, or workspace
 * id), an outcome, a taxonomy error code, token COUNTS, and latency.
 * Those record shapes have nowhere to put an api key, a bearer token, or the
 * raw prompt/response text (see records.ts), and the 0007 table has no column
 * for one either. This file therefore cannot persist a secret or model content
 * even by mistake: there is no field to read one from and no column to write
 * one to. It also performs no logging.
 *
 * ONE ROW PER EXECUTION. The controlled-provider adapter emits several records
 * per call — a usage + an execution record on success, an execution + a failure
 * record on failure — all sharing one idempotency key. The durable, tenant-
 * scoped `provider_execution` row is written SOLELY from the execution record
 * (the only record that carries tenant/project/brief scope). recordUsage /
 * recordFailure are part of the sink interface but never write a competing row:
 * the token usage is already persisted as the OK row's token columns and the
 * failure as the ERROR row's error_code, so re-persisting a tenant-unscoped
 * usage/failure record would either duplicate a fact or write an un-scoped row —
 * the ledger does neither. "Same key -> one row" is thus a structural property,
 * reinforced by an ON CONFLICT (idempotency_key) DO NOTHING insert.
 */
import type { Queryable } from "../../persistence/database-port.js";
import { isProviderErrorCode, type ProviderErrorCode } from "./errors.js";
import {
  isProviderGatewayVendor,
  isProviderModelVendor,
  isProviderProtocol,
  type ProviderIdentity,
} from "./identity.js";
import type { ProviderCallObserver } from "./openai-compatible-adapter.js";
import type {
  ProviderExecutionRecord,
  ProviderFailureRecord,
  ProviderUsageRecord,
} from "./records.js";

/**
 * A durable, tenant+project-scoped provider-execution row, read back from the
 * 0007 `provider_execution` table. Non-secret and content-free by construction —
 * it mirrors the table, which has no api-key/prompt/response column.
 */
export interface ProviderExecutionLedgerEntry {
  readonly id: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly articleBriefId: string;
  readonly model: string;
  /**
   * Canonical Provider Identity (identity.ts) as persisted on the row. A
   * pre-0008 backfilled row reads gatewayVendor 'UNKNOWN_LEGACY'; a row written
   * by the runtime always carries the declared adapter identity.
   */
  readonly identity: ProviderIdentity;
  readonly status: "OK" | "ERROR";
  readonly errorCode: ProviderErrorCode | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly latencyMs: number;
  readonly createdAt: string;
}

/** Tenant+project scope for a scoped read. Both are required — no cross-tenant read. */
export interface ProviderLedgerScope {
  readonly clientOrganizationId: string;
  readonly projectId: string;
}

/**
 * The record-sink interface the controlled-provider boundary emits to. Every
 * method is async (a durable write); a ProviderCallObserver bridge for the D2
 * adapter is produced by PgProviderLedger.asObserver().
 */
export interface ProviderExecutionRecordSink {
  recordExecution(record: ProviderExecutionRecord): Promise<void>;
  recordUsage(record: ProviderUsageRecord): Promise<void>;
  recordFailure(record: ProviderFailureRecord): Promise<void>;
}

/** Raw row shape as returned by the driver (snake_case, driver-native types). */
interface ProviderExecutionRow {
  id: string;
  request_id: string;
  idempotency_key: string;
  project_id: string;
  client_organization_id: string;
  article_brief_id: string;
  model: string;
  gateway_vendor: string;
  model_vendor: string;
  protocol: string;
  status: string;
  error_code: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  created_at: Date;
}

function toStatus(value: string): "OK" | "ERROR" {
  if (value !== "OK" && value !== "ERROR") {
    throw new Error(`provider_execution.status has an unexpected value: ${value}`);
  }
  return value;
}

function toErrorCode(value: string | null): ProviderErrorCode | null {
  if (value === null) return null;
  if (!isProviderErrorCode(value)) {
    throw new Error(`provider_execution.error_code is off-taxonomy: ${value}`);
  }
  return value;
}

/** Validate the three identity columns against the closed sets in identity.ts. */
function toIdentity(row: ProviderExecutionRow): ProviderIdentity {
  const { gateway_vendor, model_vendor, protocol } = row;
  if (!isProviderGatewayVendor(gateway_vendor)) {
    throw new Error(`provider_execution.gateway_vendor is off-enum: ${gateway_vendor}`);
  }
  if (!isProviderModelVendor(model_vendor)) {
    throw new Error(`provider_execution.model_vendor is off-enum: ${model_vendor}`);
  }
  if (!isProviderProtocol(protocol)) {
    throw new Error(`provider_execution.protocol is off-enum: ${protocol}`);
  }
  return { gatewayVendor: gateway_vendor, modelVendor: model_vendor, protocol };
}

function mapRow(row: ProviderExecutionRow): ProviderExecutionLedgerEntry {
  return {
    id: row.id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    projectId: row.project_id,
    clientOrganizationId: row.client_organization_id,
    articleBriefId: row.article_brief_id,
    model: row.model,
    identity: toIdentity(row),
    status: toStatus(row.status),
    errorCode: toErrorCode(row.error_code),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Postgres-backed durable ledger for controlled-provider executions.
 *
 * The tenant scope (client_organization_id) is NOT taken from the record — it is
 * derived authoritatively from the owning `project` row inside the INSERT, so a
 * caller can never mis-attribute an execution to a tenant that does not own the
 * project. A record for an unknown project is rejected (no row is written).
 */
export class PgProviderLedger implements ProviderExecutionRecordSink {
  readonly #db: Queryable;
  /** In-flight writes enqueued through asObserver(), awaited by drain(). */
  #pending: Promise<void>[] = [];

  constructor(db: Queryable) {
    this.#db = db;
  }

  /**
   * Persist one execution as a single append-only `provider_execution` row.
   *
   * Idempotent on idempotency_key: a second call with the same key is a no-op
   * (ON CONFLICT DO NOTHING), so re-emission / retry yields exactly one row and
   * never trips the table's append-only UPDATE/DELETE triggers. NO SECRET and NO
   * raw content is read or written — only the record's non-secret fields.
   */
  async recordExecution(record: ProviderExecutionRecord): Promise<void> {
    const usage = record.usage;
    const errorCode = record.errorCode;

    const res = await this.#db.query<{ id: string }>(
      `INSERT INTO provider_execution
         (request_id, idempotency_key, project_id, client_organization_id, article_brief_id,
          model, gateway_vendor, model_vendor, protocol,
          status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms)
       SELECT $1, $2, p.id, p.client_organization_id, $4::uuid,
              $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       FROM project p
       WHERE p.id = $3::uuid
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        record.requestId,
        record.idempotencyKey,
        record.projectId,
        record.articleBriefId,
        record.model,
        // Canonical identity — three closed-enum strings, never a URL/host/key.
        record.identity.gatewayVendor,
        record.identity.modelVendor,
        record.identity.protocol,
        record.outcome,
        errorCode,
        usage ? usage.promptTokens : null,
        usage ? usage.completionTokens : null,
        usage ? usage.totalTokens : null,
        record.latencyMs,
      ],
    );

    if (res.rows.length > 0) return; // a fresh row was inserted

    // No row inserted: either an idempotency conflict (fine — the row exists) or
    // the referenced project does not exist (a real error). Disambiguate so a
    // missing project is never a silent drop.
    const existing = await this.#db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM provider_execution WHERE idempotency_key = $1",
      [record.idempotencyKey],
    );
    const count = Number(existing.rows[0]?.n ?? "0");
    if (count === 0) {
      throw new Error(
        `recordExecution wrote no row for idempotencyKey=${record.idempotencyKey}: ` +
          `project ${record.projectId} does not exist.`,
      );
    }
  }

  /**
   * Part of the sink interface. Usage is already durably captured as the OK
   * row's token columns (written by recordExecution, which the adapter always
   * emits alongside the usage record), and a ProviderUsageRecord carries no
   * tenant/project scope — so this method deliberately writes NO row. The ledger
   * never persists a row it cannot tenant-scope, and never a duplicate fact.
   */
  async recordUsage(_record: ProviderUsageRecord): Promise<void> {
    // Intentionally no durable write — see the method doc and the class header.
  }

  /**
   * Part of the sink interface. The failure is already durably captured as the
   * ERROR row's error_code (written by recordExecution, which the adapter always
   * emits alongside the failure record), and a ProviderFailureRecord carries no
   * tenant/project scope — so this method deliberately writes NO row.
   */
  async recordFailure(_record: ProviderFailureRecord): Promise<void> {
    // Intentionally no durable write — see the method doc and the class header.
  }

  /**
   * Bridge this ledger onto the D2 adapter's non-secret ProviderCallObserver.
   * Each emission is enqueued as an in-flight write; call drain() to await them
   * (the observer callbacks are synchronous void, so the writes settle out of
   * band). The execution emission is the one that produces the durable row.
   */
  asObserver(): ProviderCallObserver {
    return {
      onUsage: (record) => this.#enqueue(this.recordUsage(record)),
      onExecution: (record) => this.#enqueue(this.recordExecution(record)),
      onFailure: (record) => this.#enqueue(this.recordFailure(record)),
    };
  }

  /** Await every write enqueued through asObserver() since the last drain(). */
  async drain(): Promise<void> {
    const inFlight = this.#pending;
    this.#pending = [];
    await Promise.all(inFlight);
  }

  #enqueue(write: Promise<void>): void {
    this.#pending.push(write);
  }

  /** The single row for an idempotency key, or null if none exists yet. */
  async getByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ProviderExecutionLedgerEntry | null> {
    const res = await this.#db.query<ProviderExecutionRow>(
      "SELECT * FROM provider_execution WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  /** How many rows exist for an idempotency key (0 or 1 under the unique key). */
  async countByIdempotencyKey(idempotencyKey: string): Promise<number> {
    const res = await this.#db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM provider_execution WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    return Number(res.rows[0]?.n ?? "0");
  }

  /**
   * Every execution for one tenant+project, oldest first. Both scope fields are
   * required, so a read can never span tenants.
   */
  async listByScope(scope: ProviderLedgerScope): Promise<ProviderExecutionLedgerEntry[]> {
    const res = await this.#db.query<ProviderExecutionRow>(
      `SELECT * FROM provider_execution
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY created_at ASC, id ASC`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
