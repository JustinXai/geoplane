/**
 * Real-Postgres persistence test for KNOWLEDGE_FILE_INGESTION_V1 (Agent D2).
 *
 * Runs against GEO_TEST_DATABASE_URL; skips cleanly (describe.skipIf) when no test database is
 * configured. Proves the ingestion service, wired to the REAL Pg knowledge repositories,
 * appends versions correctly:
 *   - ingest a TXT document, then a second version of the SAME document,
 *   - version_number increments (1 -> 2) and the document's current_version_number tracks it,
 *   - both versions are retrievable and the PRIOR version row is unchanged (append-only),
 *   - the extracted content for each version is retrievable from the content store,
 *   - tenant/project scope is carried onto the persisted rows.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { PgOrganizationRepository } from "../../../src/persistence/pg/organization-repository.js";
import { PgKnowledgePackageRepository } from "../../../src/runtime/knowledge/pg/package-repository.js";
import { PgKnowledgeDocumentRepository } from "../../../src/runtime/knowledge/pg/document-repository.js";
import { PgKnowledgeVersionRepository } from "../../../src/runtime/knowledge/pg/version-repository.js";
import { DefaultKnowledgeParser } from "../../../src/runtime/knowledge/ingestion/parsers.js";
import { InMemoryKnowledgeContentStore } from "../../../src/runtime/knowledge/ingestion/content-store.js";
import { KnowledgeIngestionService } from "../../../src/runtime/knowledge/ingestion/ingestion-service.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

let db: DatabasePort;

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(creatorUserId: string, key: string, name: string): Promise<string> {
  const org = await new PgOrganizationRepository(db).createIdempotent({
    type: "CLIENT",
    displayName: name,
    idempotencyKey: key,
    createdByUserId: creatorUserId,
  });
  return org.id;
}

async function createProject(clientOrgId: string, userId: string, name: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, name, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("project insert returned no row");
  return row.id;
}

describe.skipIf(testConfig === null)(
  "KNOWLEDGE_FILE_INGESTION_V1 — real database",
  () => {
    beforeAll(async () => {
      db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
      await applyMigrations(db, migrationsDir);
    });

    afterAll(async () => {
      if (db) await db.close();
    });

    beforeEach(async () => {
      await db.query(
        `TRUNCATE knowledge_snapshot, knowledge_issue, knowledge_version,
                  knowledge_document, knowledge_package, enterprise_profile,
                  project, organization, "user"
         RESTART IDENTITY CASCADE`,
      );
    });

    it("ingests a TXT then a second version; version increments, both retrievable, prior unchanged", async () => {
      const owner = await createUser("owner@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");
      const projectId = await createProject(clientOrg, owner, "Project A");
      const pkg = await new PgKnowledgePackageRepository(db).create({
        clientOrganizationId: clientOrg,
        projectId,
        title: "Enterprise KB",
        createdByUserId: owner,
      });

      const store = new InMemoryKnowledgeContentStore();
      const documents = new PgKnowledgeDocumentRepository(db);
      const versions = new PgKnowledgeVersionRepository(db);
      const service = new KnowledgeIngestionService(
        new DefaultKnowledgeParser(),
        documents,
        versions,
        store,
      );

      const base = {
        clientOrganizationId: clientOrg,
        projectId,
        packageId: pkg.id,
        createdByUserId: owner,
        title: "Company Overview",
      };

      const first = await service.ingest({
        ...base,
        source: {
          filename: "overview.txt",
          contentType: "text/plain",
          bytes: Buffer.from("First revision of the overview.", "utf8"),
        },
      });
      expect(first.outcome).toBe("INGESTED");
      if (first.outcome !== "INGESTED") return;
      expect(first.version.versionNumber).toBe(1);
      expect(first.version.clientOrganizationId).toBe(clientOrg);
      expect(first.version.projectId).toBe(projectId);
      expect(first.version.packageId).toBe(pkg.id);
      const v1Hash = first.version.contentHash;
      const v1Path = first.version.storagePath!;

      const second = await service.ingest({
        ...base,
        source: {
          filename: "overview.txt",
          contentType: "text/plain",
          bytes: Buffer.from("Second revision, expanded with pricing.", "utf8"),
        },
      });
      expect(second.outcome).toBe("INGESTED");
      if (second.outcome !== "INGESTED") return;
      // Same document identity -> a new version, not a new document.
      expect(second.document.id).toBe(first.document.id);
      expect(second.version.versionNumber).toBe(2);

      // Only one document exists in the package.
      expect(await documents.listByPackage(pkg.id)).toHaveLength(1);

      // The document's current_version_number tracks the append.
      const reloadedDoc = await documents.findById(first.document.id);
      expect(reloadedDoc!.currentVersionNumber).toBe(2);

      // Both versions retrievable; ordering + numbers stable.
      const all = await versions.listByDocument(first.document.id);
      expect(all.map((v) => v.versionNumber)).toEqual([1, 2]);

      // Prior version row is unchanged (append-only): same hash + storage path.
      expect(all[0]!.contentHash).toBe(v1Hash);
      expect(all[0]!.storagePath).toBe(v1Path);

      // Latest is v2; hashes differ across revisions.
      const latest = await versions.getLatest(first.document.id);
      expect(latest!.versionNumber).toBe(2);
      expect(latest!.contentHash).not.toBe(v1Hash);

      // Content for BOTH versions is retrievable from the store.
      expect(await store.get(v1Path)).toBe("First revision of the overview.");
      expect(await store.get(second.version.storagePath!)).toBe(
        "Second revision, expanded with pricing.",
      );

      // An in-place UPDATE of the prior version is rejected by the schema trigger.
      await expect(
        db.query(`UPDATE knowledge_version SET content_hash = 'tampered' WHERE id = $1`, [
          all[0]!.id,
        ]),
      ).rejects.toThrow(/append-only/i);
    });
  },
);
