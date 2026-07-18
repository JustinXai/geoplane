/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * OpportunityFamilyRepository port, backed by the opportunity_family (+
 * opportunity_family_member child) tables of 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY, consistent with the in-memory fake: `add` inserts a brand-new
 * family and rejects a duplicate id; there is no update/overwrite. The family
 * row and its member rows are written inside ONE transaction so a half-persisted
 * family can never exist. A family must carry at least one member (the frozen
 * OpportunityFamily.members is a non-empty tuple), so `add` rejects an empty
 * family before writing anything. Each member's authorizing decision status is
 * pinned to "APPROVED" both at the type level and by the table's CHECK.
 */
import type {
  OpportunityFamily,
  OpportunityFamilyMember,
} from "../../../contracts/geo-business/entities.js";
import type { DatabasePort } from "../../../persistence/database-port.js";
import type { OpportunityFamilyRepository } from "../ports.js";
import { isUniqueViolation } from "./pg-support.js";

interface FamilyRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  created_at: Date;
}

interface MemberRow {
  opportunity_id: string;
  authorizing_human_review_decision_id: string;
  position: number;
}

export class PgOpportunityFamilyRepository implements OpportunityFamilyRepository {
  constructor(private readonly db: DatabasePort) {}

  async add(family: OpportunityFamily): Promise<OpportunityFamily> {
    if (family.members.length === 0) {
      throw new Error(
        "PgOpportunityFamilyRepository.add: an OpportunityFamily must have at least one member.",
      );
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO opportunity_family
             (id, client_organization_id, project_id, created_at)
           VALUES ($1, $2, $3, $4)`,
          [family.id, family.clientOrganizationId, family.projectId, family.createdAt],
        );

        for (let i = 0; i < family.members.length; i += 1) {
          const member = family.members[i];
          if (!member) continue;
          await tx.query(
            `INSERT INTO opportunity_family_member
               (client_organization_id, project_id, opportunity_family_id, opportunity_id,
                authorizing_human_review_decision_id, authorizing_review_decision_status, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              family.clientOrganizationId,
              family.projectId,
              family.id,
              member.opportunityId,
              member.authorizingHumanReviewDecisionId,
              member.authorizingReviewDecisionStatus,
              i,
            ],
          );
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgOpportunityFamilyRepository: refusing to overwrite existing id "${family.id}" (append-only).`,
        );
      }
      throw err;
    }

    return family;
  }

  async getById(id: string): Promise<OpportunityFamily | undefined> {
    const res = await this.db.query<FamilyRow>(
      "SELECT * FROM opportunity_family WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;

    const memberRes = await this.db.query<MemberRow>(
      `SELECT opportunity_id, authorizing_human_review_decision_id, position
         FROM opportunity_family_member
        WHERE opportunity_family_id = $1
        ORDER BY position`,
      [id],
    );

    const members = memberRes.rows.map(
      (m): OpportunityFamilyMember => ({
        opportunityId: m.opportunity_id,
        authorizingHumanReviewDecisionId: m.authorizing_human_review_decision_id,
        authorizingReviewDecisionStatus: "APPROVED",
      }),
    );
    const first = members[0];
    if (!first) {
      throw new Error(`opportunity_family ${id} has no members (append-only invariant violated)`);
    }

    return {
      id: row.id,
      clientOrganizationId: row.client_organization_id,
      projectId: row.project_id,
      members: [first, ...members.slice(1)],
      createdAt: row.created_at.toISOString(),
    };
  }
}
