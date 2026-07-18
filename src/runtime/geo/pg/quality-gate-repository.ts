/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * QualityGateRepository port, backed by the quality_gate_result table of
 * 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY: `add`/`getById` only; a duplicate id raises 23505, translated to
 * the same append-only rejection the fake produces. A gate outcome is never a
 * bare boolean — the frozen PASSED/FAILED union is rehydrated from the status
 * column, and a FAILED row's non-empty failureReasons round-trip through the
 * failure_reasons array (a PASSED row carries none).
 */
import type { QualityGate } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { QualityGateRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface QualityGateRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_draft_id: string;
  status: "PASSED" | "FAILED";
  failure_reasons: string[];
  evaluated_at: Date;
}

function mapRow(row: QualityGateRow): QualityGate {
  const base = {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    articleDraftId: row.article_draft_id,
    evaluatedAt: row.evaluated_at.toISOString(),
  };

  if (row.status === "FAILED") {
    const reasons = row.failure_reasons;
    const first = reasons[0];
    if (!first) {
      throw new Error(`quality_gate_result ${row.id} is FAILED but has no failure reasons`);
    }
    return { ...base, status: "FAILED", failureReasons: [first, ...reasons.slice(1)] };
  }
  return { ...base, status: "PASSED" };
}

export class PgQualityGateRepository implements QualityGateRepository {
  constructor(private readonly db: Queryable) {}

  async add(gate: QualityGate): Promise<QualityGate> {
    const failureReasons = gate.status === "FAILED" ? gate.failureReasons : [];

    const p = new ParamList();
    const text = `INSERT INTO quality_gate_result
        (id, client_organization_id, project_id, article_draft_id, status, failure_reasons, evaluated_at)
      VALUES (${p.add(gate.id)}, ${p.add(gate.clientOrganizationId)}, ${p.add(gate.projectId)},
              ${p.add(gate.articleDraftId)}, ${p.add(gate.status)},
              ${p.array(failureReasons, "text[]")}, ${p.add(gate.evaluatedAt)})
      RETURNING *`;

    let res;
    try {
      res = await this.db.query<QualityGateRow>(text, p.values);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgQualityGateRepository: refusing to overwrite existing id "${gate.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("quality_gate_result insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<QualityGate | undefined> {
    const res = await this.db.query<QualityGateRow>(
      "SELECT * FROM quality_gate_result WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
