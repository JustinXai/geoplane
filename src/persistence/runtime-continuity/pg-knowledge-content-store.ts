/**
 * RUNTIME_DATA_CONTINUITY_V1 batch 2 (Agent B2) — DURABLE_KNOWLEDGE_CONTENT_STORE.
 *
 * Real-Postgres implementation of the knowledge ingestion `KnowledgeContentStore`
 * port (src/runtime/knowledge/ingestion/content-store.ts), backed by the
 * content-addressed `knowledge_content` table added in
 * migrations/0006_knowledge_content.sql.
 *
 * This REPLACES the composition root's `InMemoryKnowledgeContentStore`, which
 * held every uploaded document's extracted TEXT in a process-local Map — lost on
 * restart (supervisor DATA_CONTINUITY_AUDIT GAP #1). Persisting the text here is
 * exactly what lets an enterprise document's extracted text survive an
 * application restart: a fresh process, over a fresh connection pool, reads the
 * same bytes back by the same content-address key.
 *
 * Content-addressed & immutable, matching InMemoryKnowledgeContentStore's
 * idempotency contract: the `storagePath` the ingestion service computes IS the
 * key (its last segment is the sha256 of the text). Re-putting the SAME key with
 * IDENTICAL bytes is a no-op; a put of DIFFERENT bytes under the same key is
 * rejected — a content-address is immutable, so recorded knowledge text can never
 * be silently overwritten. The DB backs this with forbid-UPDATE/DELETE triggers.
 *
 * Tenancy: the `KnowledgeContentStore` interface the ingestion service calls is
 * `put(storagePath, text)` / `get(storagePath)` — no tenant argument — and the
 * composition wires ONE pool-bound store across all tenants. So this adapter
 * carries an OPTIONAL tenant scope: an unscoped store (the plain singleton swap)
 * records NULL tenant, while a tenant-scoped instance (via `forTenant`) records
 * the real, FK-enforced organization/project ids on every put.
 */
import { createHash } from "node:crypto";
import type { Queryable, SqlParam } from "../database-port.js";
import type { KnowledgeContentStore } from "../../runtime/knowledge/ingestion/content-store.js";

/** Tenant attribution for content written through a scoped store instance. */
export interface KnowledgeContentTenantScope {
  readonly clientOrganizationId: string;
  readonly projectId: string;
}

interface KnowledgeContentHashRow {
  content_hash: string;
}

interface KnowledgeContentTextRow {
  content_text: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class PgKnowledgeContentStore implements KnowledgeContentStore {
  constructor(
    private readonly db: Queryable,
    private readonly scope?: KnowledgeContentTenantScope,
  ) {}

  /**
   * Return a tenant-scoped view over the same connection: content written through
   * it is attributed to `scope` (FK-enforced). Reads remain by content-address
   * key. Lets a single pool-bound store attribute writes per tenant without
   * changing the ingestion service's `put(storagePath, text)` call shape.
   */
  forTenant(scope: KnowledgeContentTenantScope): PgKnowledgeContentStore {
    return new PgKnowledgeContentStore(this.db, scope);
  }

  async put(storagePath: string, text: string): Promise<string> {
    const contentHash = sha256Hex(text);
    const orgId: SqlParam = this.scope ? this.scope.clientOrganizationId : null;
    const projectId: SqlParam = this.scope ? this.scope.projectId : null;

    // Fresh keys insert; a colliding key does NOTHING here (no UPDATE fires, so
    // the append-only trigger is not tripped) and is verified below.
    const inserted = await this.db.query(
      `INSERT INTO knowledge_content
         (storage_path, content_hash, content_text, client_organization_id, project_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (storage_path) DO NOTHING
       RETURNING storage_path`,
      [storagePath, contentHash, text, orgId, projectId],
    );
    if (inserted.rowCount > 0) return storagePath;

    // Key already present: enforce content-addressed immutability. Identical
    // bytes -> idempotent no-op; different bytes for the same key -> reject.
    const existing = await this.db.query<KnowledgeContentHashRow>(
      `SELECT content_hash FROM knowledge_content WHERE storage_path = $1`,
      [storagePath],
    );
    const row = existing.rows[0];
    if (!row) {
      // Vanishingly unlikely (row present on conflict but gone on re-read);
      // surface rather than silently swallow.
      throw new Error(
        `PgKnowledgeContentStore.put: content at "${storagePath}" conflicted but could not be re-read.`,
      );
    }
    if (row.content_hash !== contentHash) {
      throw new Error(
        `PgKnowledgeContentStore.put: refusing to overwrite content-addressed key "${storagePath}" ` +
          `with different bytes (stored hash ${row.content_hash}, incoming hash ${contentHash}); ` +
          `a content-address is immutable.`,
      );
    }
    return storagePath;
  }

  async get(storagePath: string): Promise<string | null> {
    const res = await this.db.query<KnowledgeContentTextRow>(
      `SELECT content_text FROM knowledge_content WHERE storage_path = $1`,
      [storagePath],
    );
    const row = res.rows[0];
    return row ? row.content_text : null;
  }
}
