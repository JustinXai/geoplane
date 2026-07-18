/**
 * RUNTIME_DATA_CONTINUITY_V1 (Agent B) — real Postgres adapter for the geo
 * `ProviderArticleContentRepository` port (src/runtime/geo/ports.ts), backed by
 * the append-only `provider_article_content` table added in
 * migrations/0005_runtime_continuity.sql.
 *
 * Replaces the composition root's append-only in-memory
 * `MemProviderArticleContentRepository`. Persisting these rows is exactly what
 * lets the DETERMINISTIC offline-provider output survive a process restart
 * WITHOUT ever re-calling a provider — the row stores only an opaque
 * out-of-band envelope pointer, never the raw payload, so "Provider Calls = 0"
 * stays structural.
 *
 * APPEND-ONLY, consistent with the fake: `add` inserts a new record and rejects
 * a duplicate id (primary-key 23505 -> the same append-only rejection the fake
 * produces). No update/overwrite; the table's triggers forbid UPDATE/DELETE.
 *
 * Versioning: the geo-business `ProviderArticleContent` contract carries no
 * version field, so `add` assigns a persistence-level, per-brief monotonic
 * `version` (MAX(version)+1 for the article_brief_id) in the same INSERT. That
 * version orders the append history and is not surfaced on the contract entity.
 */
import type { ProviderArticleContent } from "../../contracts/geo-business/entities.js";
import type { Queryable } from "../database-port.js";
import type { ProviderArticleContentRepository } from "../../runtime/geo/ports.js";

const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

interface ProviderArticleContentRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_brief_id: string;
  provider_response_envelope_id: string;
  version: number;
  received_at: Date;
}

function mapRow(row: ProviderArticleContentRow): ProviderArticleContent {
  return {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    articleBriefId: row.article_brief_id,
    providerResponseEnvelopeId: row.provider_response_envelope_id,
    receivedAt: row.received_at.toISOString(),
  };
}

export class PgProviderArticleContentRepository implements ProviderArticleContentRepository {
  constructor(private readonly db: Queryable) {}

  async add(content: ProviderArticleContent): Promise<ProviderArticleContent> {
    try {
      const res = await this.db.query<ProviderArticleContentRow>(
        `INSERT INTO provider_article_content
           (id, client_organization_id, project_id, article_brief_id,
            provider_response_envelope_id, version, received_at)
         VALUES ($1, $2, $3, $4, $5,
           (SELECT COALESCE(MAX(pac.version), 0) + 1
              FROM provider_article_content pac
              WHERE pac.article_brief_id = $4),
           $6)
         RETURNING *`,
        [
          content.id,
          content.clientOrganizationId,
          content.projectId,
          content.articleBriefId,
          content.providerResponseEnvelopeId,
          content.receivedAt,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new Error("provider_article_content insert returned no row");
      return mapRow(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgProviderArticleContentRepository.add: refusing to overwrite existing id "${content.id}" (append-only).`,
        );
      }
      throw err;
    }
  }

  async listByArticleBrief(articleBriefId: string): Promise<ProviderArticleContent[]> {
    const res = await this.db.query<ProviderArticleContentRow>(
      `SELECT * FROM provider_article_content
       WHERE article_brief_id = $1
       ORDER BY version, id`,
      [articleBriefId],
    );
    return res.rows.map(mapRow);
  }
}
