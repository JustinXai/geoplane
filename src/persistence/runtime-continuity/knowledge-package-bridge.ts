/**
 * RUNTIME_DATA_CONTINUITY_V1 (Agent B) — the KnowledgePackage BRIDGE.
 *
 * Implements the geo consumer-defined `KnowledgePackageRepository` port
 * (src/runtime/geo/ports.ts) OVER the EXISTING `knowledge_package` table from
 * migration 0002 — the table owned by the knowledge runtime and already the
 * durable home of a client's enterprise knowledge base. It does NOT create or
 * read any second knowledge_package copy: there is exactly ONE source of truth
 * for enterprise knowledge, and this bridge projects that canonical row into the
 * geo-business `KnowledgePackage` contract shape
 * (src/contracts/geo-business/entities.ts).
 *
 * This replaces the append-only in-memory `MemKnowledgePackageRepository` the
 * composition root used while migration 0003 stored the aggregate as an opaque,
 * non-persisted UUID (see the composition root's "Deliberately-transient
 * aggregates" header).
 *
 * Two knowledge fields have no column in knowledge_package (0002) and are
 * therefore DERIVED projections, documented in STORAGE_MAP.md:
 *   - `version`           : ROW_NUMBER() over the row's (client_organization_id,
 *                           project_id) scope ordered by (created_at, id) — a
 *                           deterministic, monotonic-per-scope version, exactly
 *                           the contract's "monotonically increasing per
 *                           (clientOrganizationId, projectId)".
 *   - `sourceDescription` : a stable human-readable projection over the
 *                           canonical row's classification.
 * Status maps knowledge `CONFIRMED` (immutable) -> geo `SEALED`; `DRAFT` /
 * `IN_REVIEW` -> geo `DRAFT`.
 *
 * Write path (`add`): geo-originated creation is not the canonical entry point
 * — enterprise knowledge is created through the knowledge runtime, which carries
 * the creating-user provenance knowledge_package.created_by_user_id requires and
 * the geo-business shape does not. `add` therefore writes into the SAME single
 * source of truth (knowledge_package), but only when the bridge has been wired
 * with a service-principal `createdByUserId`; otherwise it throws a clear error
 * rather than fabricating a provenance identity. No provider/network surface.
 */
import type { KnowledgePackage } from "../../contracts/geo-business/entities.js";
import type { Queryable } from "../database-port.js";
import type { KnowledgePackageRepository, TenantScope } from "../../runtime/geo/ports.js";

/** Postgres unique_violation. A duplicate primary key surfaces here on `add`. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * The subset of the 0002 knowledge_package columns this bridge projects, plus
 * the derived `geo_version` (a bigint from ROW_NUMBER, returned by node-postgres
 * as a string).
 */
interface KnowledgePackageBridgeRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  title: string;
  /** DRAFT | IN_REVIEW | CONFIRMED (knowledge-runtime KnowledgePackageStatus). */
  status: string;
  classification: string;
  created_at: Date;
  confirmed_at: Date | null;
  geo_version: string;
}

/**
 * Stable, human-readable projection for the geo-business `sourceDescription`
 * field, which the canonical knowledge_package row does not store directly.
 */
function deriveSourceDescription(classification: string): string {
  return `Enterprise knowledge package (classification ${classification}) — canonical knowledge_package (migration 0002).`;
}

function mapRow(row: KnowledgePackageBridgeRow): KnowledgePackage {
  const base = {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    version: Number(row.geo_version),
    title: row.title,
    sourceDescription: deriveSourceDescription(row.classification),
    createdAt: row.created_at.toISOString(),
  };
  if (row.status === "CONFIRMED") {
    // A CONFIRMED knowledge package is immutable history -> geo-business SEALED.
    const sealedAt = (row.confirmed_at ?? row.created_at).toISOString();
    return { ...base, status: "SEALED", sealedAt };
  }
  return { ...base, status: "DRAFT" };
}

/** ROW_NUMBER projection reused by getById (unscoped) and listByScope (scoped). */
const RANKED_CTE = `
  WITH ranked AS (
    SELECT kp.id,
           kp.client_organization_id,
           kp.project_id,
           kp.title,
           kp.status,
           kp.classification,
           kp.created_at,
           kp.confirmed_at,
           ROW_NUMBER() OVER (
             PARTITION BY kp.client_organization_id, kp.project_id
             ORDER BY kp.created_at, kp.id
           ) AS geo_version
    FROM knowledge_package kp
  )`;

export interface KnowledgePackageBridgeOptions {
  /**
   * Service-principal user id used as knowledge_package.created_by_user_id for
   * geo-originated `add` writes. Enterprise knowledge is normally created
   * through the knowledge runtime (which supplies real per-user provenance);
   * wire this only if the geo runtime must also be able to create packages.
   * When unset, `add` throws instead of inventing a provenance identity.
   */
  readonly createdByUserId?: string;
  /**
   * Classification stamped on geo-originated `add` writes (the geo-business
   * KnowledgePackage shape carries none). Defaults to the table default,
   * "INTERNAL".
   */
  readonly classification?: string;
}

export class KnowledgePackageBridge implements KnowledgePackageRepository {
  constructor(
    private readonly db: Queryable,
    private readonly options: KnowledgePackageBridgeOptions = {},
  ) {}

  async add(kp: KnowledgePackage): Promise<KnowledgePackage> {
    const createdByUserId = this.options.createdByUserId;
    if (!createdByUserId) {
      throw new Error(
        "KnowledgePackageBridge.add: knowledge_package is the single source of truth owned by the " +
          "knowledge runtime. Geo-originated creation requires a service-principal user id " +
          "(KnowledgePackageBridgeOptions.createdByUserId); otherwise create enterprise knowledge " +
          "through the knowledge runtime. Refusing to fabricate a provenance identity.",
      );
    }
    const knowledgeStatus = kp.status === "SEALED" ? "CONFIRMED" : "DRAFT";
    const classification = this.options.classification ?? "INTERNAL";
    // knowledge_package's confirmed_fields CHECK requires confirmed_at +
    // confirmed_by_user_id iff status = CONFIRMED, and both NULL otherwise.
    const confirmedAt = kp.status === "SEALED" ? kp.sealedAt : null;
    const confirmedByUserId = kp.status === "SEALED" ? createdByUserId : null;
    try {
      await this.db.query(
        `INSERT INTO knowledge_package
           (id, client_organization_id, project_id, title, status, classification,
            created_by_user_id, created_at, updated_at, confirmed_at, confirmed_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)`,
        [
          kp.id,
          kp.clientOrganizationId,
          kp.projectId,
          kp.title,
          knowledgeStatus,
          classification,
          createdByUserId,
          kp.createdAt,
          confirmedAt,
          confirmedByUserId,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `KnowledgePackageBridge.add: refusing to overwrite existing knowledge_package id "${kp.id}" (append-only).`,
        );
      }
      throw err;
    }
    const stored = await this.getById(kp.id);
    if (!stored) {
      throw new Error("KnowledgePackageBridge.add: inserted knowledge_package row was not readable back");
    }
    return stored;
  }

  async getById(id: string): Promise<KnowledgePackage | undefined> {
    const res = await this.db.query<KnowledgePackageBridgeRow>(
      `${RANKED_CTE}
       SELECT * FROM ranked WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async listByScope(scope: TenantScope): Promise<KnowledgePackage[]> {
    const res = await this.db.query<KnowledgePackageBridgeRow>(
      `${RANKED_CTE}
       SELECT * FROM ranked
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY created_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return res.rows.map(mapRow);
  }
}
