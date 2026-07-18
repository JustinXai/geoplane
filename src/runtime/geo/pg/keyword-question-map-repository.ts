/**
 * KEYWORD_OPPORTUNITY_RUNTIME_V1 — Postgres adapter for the E1
 * KeywordQuestionMapRepository port (src/runtime/geo/ports.ts), backed by the
 * keyword_question_map (+ keyword/question child) tables of
 * migrations/0003_geo_runtime.sql.
 *
 * APPEND-ONLY, consistent with the in-memory fake: `add` inserts a brand-new
 * record and rejects a duplicate id. There is deliberately no update/overwrite.
 * The map + its keyword rows + its question rows are written inside ONE
 * transaction so a half-persisted map can never exist. A KeywordQuestionMap
 * entry must carry at least one question (the whole point of the mapping), so
 * `add` rejects an entry with zero questions before writing anything.
 */
import type {
  KeywordQuestionEntry,
  KeywordQuestionMap,
} from "../../../contracts/geo-business/entities.js";
import type { DatabasePort } from "../../../persistence/database-port.js";
import type { KeywordQuestionMapRepository, TenantScope } from "../ports.js";

interface MapRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  knowledge_package_id: string;
  knowledge_package_version: number;
  industry_profile_id: string;
  created_at: Date;
}

interface KeywordRow {
  id: string;
  keyword_question_map_id: string;
  keyword: string;
  position: number;
}

interface QuestionRow {
  keyword_id: string;
  question: string;
  position: number;
}

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

export class PgKeywordQuestionMapRepository implements KeywordQuestionMapRepository {
  constructor(private readonly db: DatabasePort) {}

  async add(map: KeywordQuestionMap): Promise<KeywordQuestionMap> {
    const emptyEntry = map.entries.find((e) => e.questions.length === 0);
    if (emptyEntry) {
      throw new Error(
        `PgKeywordQuestionMapRepository.add: keyword "${emptyEntry.keyword}" has zero ` +
          `questions; a KeywordQuestionMap entry must map a keyword to at least one question.`,
      );
    }

    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO keyword_question_map
             (id, client_organization_id, project_id, knowledge_package_id,
              knowledge_package_version, industry_profile_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            map.id,
            map.clientOrganizationId,
            map.projectId,
            map.knowledgePackageId,
            map.knowledgePackageVersion,
            map.industryProfileId,
            map.createdAt,
          ],
        );

        for (let k = 0; k < map.entries.length; k += 1) {
          const entry = map.entries[k];
          if (!entry) continue;
          const keywordRes = await tx.query<{ id: string }>(
            `INSERT INTO keyword_question_map_keyword
               (client_organization_id, project_id, keyword_question_map_id, keyword, position)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [map.clientOrganizationId, map.projectId, map.id, entry.keyword, k],
          );
          const keywordRow = keywordRes.rows[0];
          if (!keywordRow) throw new Error("keyword insert returned no row");

          for (let q = 0; q < entry.questions.length; q += 1) {
            const question = entry.questions[q];
            if (question === undefined) continue;
            await tx.query(
              `INSERT INTO keyword_question_map_question
                 (client_organization_id, project_id, keyword_question_map_id,
                  keyword_id, question, position)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [map.clientOrganizationId, map.projectId, map.id, keywordRow.id, question, q],
            );
          }
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgKeywordQuestionMapRepository: refusing to overwrite existing id "${map.id}" (append-only).`,
        );
      }
      throw err;
    }

    return map;
  }

  async getById(id: string): Promise<KeywordQuestionMap | undefined> {
    const res = await this.db.query<MapRow>(
      "SELECT * FROM keyword_question_map WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async listByScope(scope: TenantScope): Promise<KeywordQuestionMap[]> {
    const res = await this.db.query<MapRow>(
      `SELECT * FROM keyword_question_map
       WHERE client_organization_id = $1 AND project_id = $2
       ORDER BY created_at, id`,
      [scope.clientOrganizationId, scope.projectId],
    );
    const maps: KeywordQuestionMap[] = [];
    for (const row of res.rows) {
      maps.push(await this.hydrate(row));
    }
    return maps;
  }

  private async hydrate(row: MapRow): Promise<KeywordQuestionMap> {
    const keywordRes = await this.db.query<KeywordRow>(
      `SELECT id, keyword_question_map_id, keyword, position
         FROM keyword_question_map_keyword
        WHERE keyword_question_map_id = $1
        ORDER BY position`,
      [row.id],
    );
    const questionRes = await this.db.query<QuestionRow>(
      `SELECT keyword_id, question, position
         FROM keyword_question_map_question
        WHERE keyword_question_map_id = $1
        ORDER BY position`,
      [row.id],
    );

    const questionsByKeywordId = new Map<string, string[]>();
    for (const q of questionRes.rows) {
      const list = questionsByKeywordId.get(q.keyword_id) ?? [];
      list.push(q.question);
      questionsByKeywordId.set(q.keyword_id, list);
    }

    const entries: KeywordQuestionEntry[] = keywordRes.rows.map((kw) => ({
      keyword: kw.keyword,
      questions: questionsByKeywordId.get(kw.id) ?? [],
    }));

    return {
      id: row.id,
      clientOrganizationId: row.client_organization_id,
      projectId: row.project_id,
      knowledgePackageId: row.knowledge_package_id,
      knowledgePackageVersion: row.knowledge_package_version,
      industryProfileId: row.industry_profile_id,
      entries,
      createdAt: row.created_at.toISOString(),
    };
  }
}
