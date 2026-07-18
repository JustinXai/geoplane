/**
 * KEYWORD_OPPORTUNITY_RUNTIME_V1 — Postgres adapter for the E1
 * HumanReviewRepository port, backed by the append-only human_review_decision
 * table of migrations/0003_geo_runtime.sql.
 *
 * APPEND-ONLY at two layers: this adapter exposes only `add`/`getById`/
 * `listByScope` (no update), and the table forbids UPDATE/DELETE via trigger.
 *
 * NO SILENT APPROVAL: there is no code path here through which an APPROVED
 * decision can be persisted without a real reviewer. `add` takes a full
 * HumanReviewDecision, whose `reviewerId` + `decidedAt` are non-optional on
 * every variant of the frozen union; those are written to NOT-NULL columns and
 * additionally guarded by the table's ck_human_review_no_silent_approve CHECK.
 * There is no "approve with default reviewer" convenience method.
 *
 * The frozen HumanReviewDecision is a discriminated union
 * (APPROVED / CHANGES_REQUESTED / REJECTED); the variant-specific note is
 * written to / read from the matching nullable column, and the row is
 * re-hydrated back into the correct variant shape.
 */
import type {
  HumanReviewDecision,
  HumanReviewDecisionStatus,
} from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { HumanReviewRepository, TenantScope } from "../ports.js";

interface DecisionRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  opportunity_id: string;
  opportunity_validation_id: string;
  decision: HumanReviewDecisionStatus;
  reviewer_user_id: string;
  decided_at: Date;
  requested_changes_note: string | null;
  rejection_reason_note: string | null;
}

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

function mapRow(row: DecisionRow): HumanReviewDecision {
  const base = {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    opportunityId: row.opportunity_id,
    opportunityValidationId: row.opportunity_validation_id,
    reviewerId: row.reviewer_user_id,
    decidedAt: row.decided_at.toISOString(),
  };

  switch (row.decision) {
    case "APPROVED":
      return { ...base, status: "APPROVED" };
    case "CHANGES_REQUESTED":
      if (row.requested_changes_note === null) {
        throw new Error(
          `human_review_decision ${row.id} is CHANGES_REQUESTED but has no requested_changes_note`,
        );
      }
      return { ...base, status: "CHANGES_REQUESTED", requestedChangesNote: row.requested_changes_note };
    case "REJECTED":
      if (row.rejection_reason_note === null) {
        throw new Error(
          `human_review_decision ${row.id} is REJECTED but has no rejection_reason_note`,
        );
      }
      return { ...base, status: "REJECTED", rejectionReasonNote: row.rejection_reason_note };
    default: {
      const exhaustive: never = row.decision;
      throw new Error(`human_review_decision ${row.id} has unknown decision "${String(exhaustive)}"`);
    }
  }
}

export class PgHumanReviewRepository implements HumanReviewRepository {
  constructor(private readonly db: Queryable) {}

  async add(decision: HumanReviewDecision): Promise<HumanReviewDecision> {
    const requestedChangesNote =
      decision.status === "CHANGES_REQUESTED" ? decision.requestedChangesNote : null;
    const rejectionReasonNote =
      decision.status === "REJECTED" ? decision.rejectionReasonNote : null;

    let res;
    try {
      res = await this.db.query<DecisionRow>(
        `INSERT INTO human_review_decision
           (id, client_organization_id, project_id, opportunity_id, opportunity_validation_id,
            decision, reviewer_user_id, decided_at, requested_changes_note, rejection_reason_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          decision.id,
          decision.clientOrganizationId,
          decision.projectId,
          decision.opportunityId,
          decision.opportunityValidationId,
          decision.status,
          decision.reviewerId,
          decision.decidedAt,
          requestedChangesNote,
          rejectionReasonNote,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgHumanReviewRepository: refusing to overwrite existing id "${decision.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("human_review_decision insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<HumanReviewDecision | undefined> {
    const res = await this.db.query<DecisionRow>(
      "SELECT * FROM human_review_decision WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async listByScope(scope: TenantScope): Promise<HumanReviewDecision[]> {
    const res = await this.db.query<DecisionRow>(
      `SELECT * FROM human_review_decision
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY decided_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
