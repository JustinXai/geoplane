/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * ArticleDraftRepository port, backed by the append-only, versioned article_draft
 * table of 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY + VERSIONED at two layers: this adapter exposes only `add` /
 * `getById` / `listByArticleBrief` (no update), and the table itself forbids
 * UPDATE/DELETE via trigger. Each compile is a NEW row with a new id and an
 * incremented `version`; a prior version is immutable. A duplicate id raises
 * 23505, translated to the same append-only rejection the in-memory fake
 * produces.
 *
 * `sections` round-trip through the ordered section_headings TEXT[] (each section
 * is {heading, order} with order = array index, exactly as compileArticleDraft
 * builds them). The frozen DRAFT/SEALED discriminated union is rehydrated from
 * the status + sealed_at columns.
 */
import type {
  ArticleDraft,
  ArticleDraftSection,
} from "../../../contracts/geo-business/entities.js";
import type { Queryable } from "../../../persistence/database-port.js";
import type { ArticleDraftRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface DraftRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  article_brief_id: string;
  version: number;
  title: string;
  section_headings: string[];
  source_provider_article_content_ids: string[];
  status: "DRAFT" | "SEALED";
  sealed_at: Date | null;
  compiled_at: Date;
}

function mapRow(row: DraftRow): ArticleDraft {
  const sections: ArticleDraftSection[] = row.section_headings.map((heading, order) => ({
    heading,
    order,
  }));

  const sourceIds = row.source_provider_article_content_ids;
  const firstSource = sourceIds[0];
  if (!firstSource) {
    throw new Error(
      `article_draft ${row.id} has no source_provider_article_content_ids (contract requires at least one)`,
    );
  }

  const base = {
    id: row.id,
    clientOrganizationId: row.client_organization_id,
    projectId: row.project_id,
    articleBriefId: row.article_brief_id,
    sourceProviderArticleContentIds: [firstSource, ...sourceIds.slice(1)] as [string, ...string[]],
    version: row.version,
    title: row.title,
    sections,
    compiledAt: row.compiled_at.toISOString(),
  };

  if (row.status === "SEALED") {
    if (row.sealed_at === null) {
      throw new Error(`article_draft ${row.id} is SEALED but has no sealed_at`);
    }
    return { ...base, status: "SEALED", sealedAt: row.sealed_at.toISOString() };
  }
  return { ...base, status: "DRAFT" };
}

export class PgArticleDraftRepository implements ArticleDraftRepository {
  constructor(private readonly db: Queryable) {}

  async add(draft: ArticleDraft): Promise<ArticleDraft> {
    const sectionHeadings = draft.sections.map((section) => section.heading);
    const sealedAt = draft.status === "SEALED" ? draft.sealedAt : null;

    const p = new ParamList();
    const text = `INSERT INTO article_draft
        (id, client_organization_id, project_id, article_brief_id, version, title,
         section_headings, source_provider_article_content_ids, status, sealed_at, compiled_at)
      VALUES (${p.add(draft.id)}, ${p.add(draft.clientOrganizationId)}, ${p.add(draft.projectId)},
              ${p.add(draft.articleBriefId)}, ${p.add(draft.version)}, ${p.add(draft.title)},
              ${p.array(sectionHeadings, "text[]")},
              ${p.array(draft.sourceProviderArticleContentIds, "uuid[]")},
              ${p.add(draft.status)}, ${p.add(sealedAt)}, ${p.add(draft.compiledAt)})
      RETURNING *`;

    let res;
    try {
      res = await this.db.query<DraftRow>(text, p.values);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgArticleDraftRepository: refusing to overwrite existing id "${draft.id}" (append-only).`,
        );
      }
      throw err;
    }
    const row = res.rows[0];
    if (!row) throw new Error("article_draft insert returned no row");
    return mapRow(row);
  }

  async getById(id: string): Promise<ArticleDraft | undefined> {
    const res = await this.db.query<DraftRow>(
      "SELECT * FROM article_draft WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : undefined;
  }

  async listByArticleBrief(articleBriefId: string): Promise<ArticleDraft[]> {
    const res = await this.db.query<DraftRow>(
      `SELECT * FROM article_draft WHERE article_brief_id = $1 ORDER BY version, id`,
      [articleBriefId],
    );
    return res.rows.map(mapRow);
  }
}
