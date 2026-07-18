/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * VerticalGateRepository port, backed by the vertical_gate_result table of
 * 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY: `add`/`getById` only; a duplicate id raises 23505, translated to
 * the same append-only rejection the fake produces. The frozen PASSED/FAILED
 * union is rehydrated from the status column; a FAILED row's non-empty
 * failureReasons round-trip through failure_reasons. gateKind is pinned to
 * "VERTICAL_GATE" (also DB-CHECK'd).
 */
import type { VerticalGate } from "../../../contracts/geo-business/entities.js";
import type { GeoValidationGateLevel } from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { VerticalGateRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface VerticalGateRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_draft_id: string;
  industry_profile_id: string;
  gate_level_applied: GeoValidationGateLevel;
  status: "PASSED" | "FAILED";
  failure_reasons: string[];
  evaluated_at: Date;
}

function mapRow(row: VerticalGateRow): VerticalGate {
  const base = {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    gateKind: "VERTICAL_GATE" as const,
    articleDraftId: row.article_draft_id,
    industryProfileId: row.industry_profile_id,
    gateLevelApplied: row.gate_level_applied,
    evaluatedAt: row.evaluated_at.toISOString(),
  };

  if (row.status === "FAILED") {
    const reasons = row.failure_reasons;
    const first = reasons[0];
    if (!first) {
      throw new Error(`vertical_gate_result ${row.id} is FAILED but has no failure reasons`);
    }
    return { ...base, status: "FAILED", failureReasons: [first, ...reasons.slice(1)] };
  }
  return { ...base, status: "PASSED" };
}

export class PgVerticalGateRepository implements VerticalGateRepository {
  constructor(private readonly db: Queryable) {}

  async add(gate: VerticalGate): Promise<VerticalGate> {
    const failureReasons = gate.status === "FAILED" ? gate.failureReasons : [];

    const p = new ParamList();
    const text = `INSERT INTO vertical_gate_result
        (id, client_organization_id, project_id, article_draft_id, gate_kind, industry_profile_id,
         gate_level_applied, status, failure_reasons, evaluated_at)
      VALUES (${p.add(gate.id)}, ${p.add(gate.clientOrganizationId)}, ${p.add(gate.projectId)},
              ${p.add(gate.articleDraftId)}, ${p.add(gate.gateKind)}, ${p.add(gate.industryProfileId)},
              ${p.add(gate.gateLevelApplied)}, ${p.add(gate.status)},
              ${p.array(failureReasons, "text[]")}, ${p.add(gate.evaluatedAt)})
      RETURNING *`;

    let res;
    try {
      res = await this.db.query<VerticalGateRow>(text, p.values);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgVerticalGateRepository: refusing to overwrite existing id "${gate.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("vertical_gate_result insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<VerticalGate | undefined> {
    const res = await this.db.query<VerticalGateRow>(
      "SELECT * FROM vertical_gate_result WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }
}
