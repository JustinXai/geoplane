/**
 * RUNTIME_DATA_CONTINUITY_V1 batch 2 (Agent B2) — real-Postgres tests for the
 * DURABLE knowledge content store that replaces the composition root's
 * process-local InMemoryKnowledgeContentStore (supervisor DATA_CONTINUITY_AUDIT
 * GAP #1: extracted document TEXT was held only in memory and LOST on restart).
 *
 * Backed by migrations/0006_knowledge_content.sql. Runs against
 * GEO_TEST_DATABASE_URL (a throwaway database, geoplane_pc_b); when no test
 * database is configured the whole suite skips cleanly, like the other
 * *.pg.test.ts suites.
 *
 * Proves, for real:
 *   1. migration 0006 applies via applyMigrations and knowledge_content exists.
 *   2. put -> get round-trips the extracted text; a missing key returns null.
 *   3. RESTART DURABILITY: text written through one createPgDatabase pool is read
 *      back through a NEW pool + a NEW PgKnowledgeContentStore after the first
 *      pool is fully closed — the actual gap this checkpoint closes.
 *   4. content-addressed immutability: a re-put of the same key with IDENTICAL
 *      bytes is an idempotent no-op; a put of DIFFERENT bytes under the same key
 *      is rejected; UPDATE/DELETE are forbidden at the DB level.
 *   5. tenant scoping: a tenant-scoped store attributes rows to a real, FK-backed
 *      organization/project; an unknown organization is rejected by the FK.
 */
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { PgKnowledgeContentStore } from "../../src/persistence/runtime-continuity/pg-knowledge-content-store.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

let db: DatabasePort;

interface Tenant {
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
}

async function createUser(conn: DatabasePort, email: string): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(conn: DatabasePort, key: string, userId: string): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    [key, key, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("organization insert returned no row");
  return row.id;
}

async function createProject(
  conn: DatabasePort,
  clientOrgId: string,
  userId: string,
  name: string,
): Promise<string> {
  const res = await conn.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, name, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("project insert returned no row");
  return row.id;
}

async function bootstrapTenant(conn: DatabasePort, key: string): Promise<Tenant> {
  const userId = await createUser(conn, `${key}-${randomUUID()}@example.test`);
  const orgId = await createClientOrg(conn, `client-${key}-${randomUUID()}`, userId);
  const projectId = await createProject(conn, orgId, userId, `Project ${key}`);
  return { orgId, projectId, userId };
}

/**
 * A content-address key shaped exactly like the ingestion service computes
 * (`knowledge/{package}/{document}/{content_hash}`). Randomized package/document
 * segments keep keys unique per call; the last segment is the real sha256 so the
 * key is a faithful content-address.
 */
function contentAddress(text: string): string {
  const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
  return `knowledge/${randomUUID()}/${randomUUID()}/${contentHash}`;
}

async function truncateAll(conn: DatabasePort): Promise<void> {
  await conn.query(
    `TRUNCATE knowledge_content, project, organization, "user" RESTART IDENTITY CASCADE`,
  );
}

describe.skipIf(testConfig === null)(
  "DURABLE_KNOWLEDGE_CONTENT_STORE — real database persistence",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
    });

    afterAll(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await truncateAll(db);
    });

    // -----------------------------------------------------------------------
    // 1. Migration 0006
    // -----------------------------------------------------------------------

    it("applies migration 0006 and creates the knowledge_content table", async () => {
      const ledger = await db.query<{ filename: string }>(
        `SELECT filename FROM schema_migrations WHERE filename = $1`,
        ["0006_knowledge_content.sql"],
      );
      expect(ledger.rows[0]?.filename).toBe("0006_knowledge_content.sql");

      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_content`,
      );
      expect(count.rows[0]?.n).toBe("0");
    });

    // -----------------------------------------------------------------------
    // 2. Round-trip
    // -----------------------------------------------------------------------

    it("puts extracted text and gets it back (round-trip); a missing key is null", async () => {
      const store = new PgKnowledgeContentStore(db);
      const path = contentAddress("Acme Corp founded in 1998. Ships enterprise widgets.");
      const text = "Acme Corp founded in 1998. Ships enterprise widgets.";

      const returned = await store.put(path, text);
      expect(returned).toBe(path);

      const fetched = await store.get(path);
      expect(fetched).toBe(text);

      const missing = await store.get(contentAddress("never stored"));
      expect(missing).toBeNull();
    });

    it("preserves empty and multi-byte extracted text exactly", async () => {
      const store = new PgKnowledgeContentStore(db);

      const emptyPath = contentAddress("");
      await store.put(emptyPath, "");
      expect(await store.get(emptyPath)).toBe("");

      const unicode = "Ünïcödé — 企業ナレッジ — \n\ttabs and newlines preserved";
      const unicodePath = contentAddress(unicode);
      await store.put(unicodePath, unicode);
      expect(await store.get(unicodePath)).toBe(unicode);
    });

    // -----------------------------------------------------------------------
    // 3. Restart durability — the actual gap this checkpoint closes
    // -----------------------------------------------------------------------

    it("reads extracted text back through a NEW pool + NEW store after the writing pool is closed (restart durability)", async () => {
      await truncateAll(db);

      const text =
        "This enterprise document text must survive a full application restart. " +
        "It lived only in an in-memory Map before migration 0006.";
      const path = contentAddress(text);

      // Process 1: write, then the pool (the process that wrote it) goes away.
      const pool1 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      try {
        await new PgKnowledgeContentStore(pool1).put(path, text);
      } finally {
        await pool1.close();
      }

      // Process 2: a brand-new pool and a brand-new store read the SAME bytes back.
      const pool2 = createPgDatabase({ connectionString: testConfig!.connectionString, max: 4 });
      try {
        const recovered = await new PgKnowledgeContentStore(pool2).get(path);
        expect(recovered).toBe(text);
      } finally {
        await pool2.close();
      }
    });

    // -----------------------------------------------------------------------
    // 4. Content-addressed immutability
    // -----------------------------------------------------------------------

    it("treats a re-put of the same key with identical bytes as an idempotent no-op", async () => {
      const store = new PgKnowledgeContentStore(db);
      const text = "Identical bytes under the same content-address key.";
      const path = contentAddress(text);

      await store.put(path, text);
      const again = await store.put(path, text);
      expect(again).toBe(path);

      // Exactly one physical row — no duplicate, no overwrite.
      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_content WHERE storage_path = $1`,
        [path],
      );
      expect(count.rows[0]?.n).toBe("1");
      expect(await store.get(path)).toBe(text);
    });

    it("rejects a put of DIFFERENT bytes under the same content-address key", async () => {
      const store = new PgKnowledgeContentStore(db);
      const path = contentAddress("original");
      await store.put(path, "original extracted text");

      await expect(store.put(path, "TAMPERED extracted text")).rejects.toThrow(/immutable/i);

      // The original bytes are untouched.
      expect(await store.get(path)).toBe("original extracted text");
    });

    it("forbids UPDATE and DELETE on the append-only knowledge_content table", async () => {
      const store = new PgKnowledgeContentStore(db);
      const path = contentAddress("append-only");
      await store.put(path, "append-only extracted text");

      await expect(
        db.query(`UPDATE knowledge_content SET content_text = 'x' WHERE storage_path = $1`, [path]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM knowledge_content WHERE storage_path = $1`, [path]),
      ).rejects.toThrow(/append-only/i);

      expect(await store.get(path)).toBe("append-only extracted text");
    });

    // -----------------------------------------------------------------------
    // 5. Tenant scoping
    // -----------------------------------------------------------------------

    it("attributes tenant-scoped content to a real FK-backed organization/project", async () => {
      const a = await bootstrapTenant(db, "tenant-a");
      const b = await bootstrapTenant(db, "tenant-b");
      const base = new PgKnowledgeContentStore(db);

      const storeA = base.forTenant({ clientOrganizationId: a.orgId, projectId: a.projectId });
      const storeB = base.forTenant({ clientOrganizationId: b.orgId, projectId: b.projectId });

      const pathA = contentAddress("tenant A knowledge");
      const pathB = contentAddress("tenant B knowledge");
      await storeA.put(pathA, "tenant A knowledge");
      await storeB.put(pathB, "tenant B knowledge");

      const rowA = await db.query<{ client_organization_id: string; project_id: string }>(
        `SELECT client_organization_id, project_id FROM knowledge_content WHERE storage_path = $1`,
        [pathA],
      );
      expect(rowA.rows[0]?.client_organization_id).toBe(a.orgId);
      expect(rowA.rows[0]?.project_id).toBe(a.projectId);

      const rowB = await db.query<{ client_organization_id: string; project_id: string }>(
        `SELECT client_organization_id, project_id FROM knowledge_content WHERE storage_path = $1`,
        [pathB],
      );
      expect(rowB.rows[0]?.client_organization_id).toBe(b.orgId);
      expect(rowB.rows[0]?.project_id).toBe(b.projectId);

      // An unscoped store records NULL tenant (the plain pool-bound singleton).
      const unscopedPath = contentAddress("unscoped knowledge");
      await base.put(unscopedPath, "unscoped knowledge");
      const rowU = await db.query<{ client_organization_id: string | null; project_id: string | null }>(
        `SELECT client_organization_id, project_id FROM knowledge_content WHERE storage_path = $1`,
        [unscopedPath],
      );
      expect(rowU.rows[0]?.client_organization_id).toBeNull();
      expect(rowU.rows[0]?.project_id).toBeNull();
    });

    it("rejects tenant-scoped content whose organization/project does not exist (FK)", async () => {
      const bogus = new PgKnowledgeContentStore(db).forTenant({
        clientOrganizationId: randomUUID(),
        projectId: randomUUID(),
      });

      // Assert the locale-independent Postgres SQLSTATE (23503 =
      // foreign_key_violation); the server's message text may be localized.
      let caught: unknown;
      try {
        await bogus.put(contentAddress("orphan"), "orphan knowledge");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect((caught as { code?: string }).code).toBe("23503");

      const count = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_content`,
      );
      expect(count.rows[0]?.n).toBe("0");
    });
  },
);
