/**
 * Real-Postgres persistence tests for KNOWLEDGE_SCHEMA_AND_PORTS_V1 (Agent D).
 *
 * These run against GEO_TEST_DATABASE_URL. When no test database is configured, the whole
 * suite skips cleanly (describe.skipIf) rather than failing. Where a database IS available,
 * they prove that migration 0002 applies through the ledger and that the knowledge ports
 * behave against the real schema:
 *   - create a package under a client org + project
 *   - add a document with two versions (version_number increments; the unique key holds)
 *   - create then resolve an issue; open-issue counts track it
 *   - seal snapshots (one current per package invariant)
 *   - upsert the enterprise profile (insert then in-place update)
 *   - tenant scoping: client A's package is invisible to a client B query
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
import { PgKnowledgeIssueRepository } from "../../../src/runtime/knowledge/pg/issue-repository.js";
import { PgKnowledgeSnapshotRepository } from "../../../src/runtime/knowledge/pg/snapshot-repository.js";
import { PgEnterpriseProfileRepository } from "../../../src/runtime/knowledge/pg/enterprise-profile-repository.js";

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

async function createClientOrg(
  creatorUserId: string,
  key: string,
  name: string,
): Promise<string> {
  const org = await new PgOrganizationRepository(db).createIdempotent({
    type: "CLIENT",
    displayName: name,
    idempotencyKey: key,
    createdByUserId: creatorUserId,
  });
  return org.id;
}

async function createProject(
  clientOrgId: string,
  userId: string,
  name: string,
): Promise<string> {
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
  "KNOWLEDGE_SCHEMA_AND_PORTS_V1 — real database",
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

    it("creates a package under a client org + project", async () => {
      const owner = await createUser("owner@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");
      const projectId = await createProject(clientOrg, owner, "Project A");

      const pkgRepo = new PgKnowledgePackageRepository(db);
      const pkg = await pkgRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        title: "Enterprise Knowledge Base",
        createdByUserId: owner,
        classification: "CONFIDENTIAL",
      });

      expect(pkg.status).toBe("DRAFT");
      expect(pkg.classification).toBe("CONFIDENTIAL");
      expect(pkg.confirmedAt).toBeNull();

      const withCounts = await pkgRepo.getWithCounts(pkg.id, clientOrg);
      expect(withCounts).not.toBeNull();
      expect(withCounts!.documentCount).toBe(0);
      expect(withCounts!.openIssueCount).toBe(0);
    });

    it("adds a document with two versions; version_number increments and the unique key holds", async () => {
      const owner = await createUser("owner@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");
      const projectId = await createProject(clientOrg, owner, "Project A");
      const pkg = await new PgKnowledgePackageRepository(db).create({
        clientOrganizationId: clientOrg,
        projectId,
        title: "KB",
        createdByUserId: owner,
      });

      const docRepo = new PgKnowledgeDocumentRepository(db);
      const doc = await docRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        packageId: pkg.id,
        title: "Company Overview",
        createdByUserId: owner,
        sourceKind: "FILE",
      });
      expect(doc.currentVersionNumber).toBe(0);

      const versionRepo = new PgKnowledgeVersionRepository(db);
      const v1 = await versionRepo.addVersion({
        documentId: doc.id,
        contentHash: "hash-v1",
        createdByUserId: owner,
        storagePath: "kb/company-overview/v1",
        byteSize: 1024,
        mimeType: "text/plain",
      });
      const v2 = await versionRepo.addVersion({
        documentId: doc.id,
        contentHash: "hash-v2",
        createdByUserId: owner,
      });

      expect(v1.versionNumber).toBe(1);
      expect(v2.versionNumber).toBe(2);
      expect(v1.byteSize).toBe(1024);
      expect(v2.byteSize).toBeNull();

      const reloaded = await docRepo.findById(doc.id);
      expect(reloaded!.currentVersionNumber).toBe(2);
      expect(await versionRepo.listByDocument(doc.id)).toHaveLength(2);
      const latest = await versionRepo.getLatest(doc.id);
      expect(latest!.versionNumber).toBe(2);

      // The (document_id, version_number) unique key rejects a duplicate version.
      await expect(
        db.query(
          `INSERT INTO knowledge_version
             (client_organization_id, project_id, package_id, document_id,
              version_number, content_hash, created_by_user_id)
           VALUES ($1, $2, $3, $4, 1, 'dup', $5)`,
          [clientOrg, projectId, pkg.id, doc.id, owner],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      // An in-place UPDATE of a version row is forbidden (append-only-friendly).
      await expect(
        db.query(`UPDATE knowledge_version SET content_hash = 'tampered' WHERE id = $1`, [
          v1.id,
        ]),
      ).rejects.toThrow(/append-only/i);
    });

    it("creates and resolves an issue; open-issue counts track resolution", async () => {
      const owner = await createUser("owner@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");
      const projectId = await createProject(clientOrg, owner, "Project A");
      const pkgRepo = new PgKnowledgePackageRepository(db);
      const pkg = await pkgRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        title: "KB",
        createdByUserId: owner,
      });

      const issueRepo = new PgKnowledgeIssueRepository(db);
      const issue = await issueRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        packageId: pkg.id,
        kind: "MISSING_INFORMATION",
        message: "Pricing page is not covered.",
        createdByUserId: owner,
        severity: "BLOCKER",
      });
      expect(issue.resolved).toBe(false);
      expect(issue.resolvedAt).toBeNull();

      expect(await issueRepo.countOpen(pkg.id)).toBe(1);
      expect(await issueRepo.listByPackage(pkg.id, true)).toHaveLength(1);
      expect((await pkgRepo.getWithCounts(pkg.id, clientOrg))!.openIssueCount).toBe(1);

      const resolved = await issueRepo.resolve(issue.id, owner);
      expect(resolved.resolved).toBe(true);
      expect(resolved.resolvedAt).not.toBeNull();
      expect(resolved.resolvedByUserId).toBe(owner);

      expect(await issueRepo.countOpen(pkg.id)).toBe(0);
      expect(await issueRepo.listByPackage(pkg.id, true)).toHaveLength(0);
      expect(await issueRepo.listByPackage(pkg.id)).toHaveLength(1);
      expect((await pkgRepo.getWithCounts(pkg.id, clientOrg))!.openIssueCount).toBe(0);
    });

    it("confirms a package and seals snapshots (one current per package)", async () => {
      const owner = await createUser("owner@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");
      const projectId = await createProject(clientOrg, owner, "Project A");
      const pkgRepo = new PgKnowledgePackageRepository(db);
      const pkg = await pkgRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        title: "KB",
        createdByUserId: owner,
      });

      const confirmed = await pkgRepo.confirm(pkg.id, owner);
      expect(confirmed.status).toBe("CONFIRMED");
      expect(confirmed.confirmedAt).not.toBeNull();
      expect(confirmed.confirmedByUserId).toBe(owner);

      const snapRepo = new PgKnowledgeSnapshotRepository(db);
      const s1 = await snapRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        packageId: pkg.id,
        contentHash: "snap-1",
        documentCount: 3,
        createdByUserId: owner,
      });
      expect(s1.snapshotNumber).toBe(1);
      expect(s1.supersededAt).toBeNull();

      const s2 = await snapRepo.create({
        clientOrganizationId: clientOrg,
        projectId,
        packageId: pkg.id,
        contentHash: "snap-2",
        documentCount: 4,
        createdByUserId: owner,
      });
      expect(s2.snapshotNumber).toBe(2);

      const current = await snapRepo.getCurrent(pkg.id);
      expect(current!.id).toBe(s2.id);
      expect(await snapRepo.listByPackage(pkg.id)).toHaveLength(2);

      // Exactly one non-superseded snapshot exists for the package.
      const openCount = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_snapshot
         WHERE package_id = $1 AND superseded_at IS NULL`,
        [pkg.id],
      );
      expect(Number(openCount.rows[0]!.n)).toBe(1);
    });

    it("upserts the enterprise profile (insert then in-place update)", async () => {
      const owner = await createUser("owner@example.test");
      const editor = await createUser("editor@example.test");
      const clientOrg = await createClientOrg(owner, "client-a", "Client A");

      const profileRepo = new PgEnterpriseProfileRepository(db);
      const created = await profileRepo.upsert({
        clientOrganizationId: clientOrg,
        legalName: "Acme Incorporated",
        actingUserId: owner,
        industry: "Manufacturing",
        defaultClassification: "INTERNAL",
      });
      expect(created.legalName).toBe("Acme Incorporated");
      expect(created.defaultClassification).toBe("INTERNAL");

      const updated = await profileRepo.upsert({
        clientOrganizationId: clientOrg,
        legalName: "Acme Corporation",
        actingUserId: editor,
        industry: "Advanced Manufacturing",
        defaultClassification: "PUBLIC",
        forbiddenUsage: "No competitor comparisons.",
      });

      // Same row (idempotent on client org), fields replaced, updated_by changed.
      expect(updated.id).toBe(created.id);
      expect(updated.legalName).toBe("Acme Corporation");
      expect(updated.defaultClassification).toBe("PUBLIC");
      expect(updated.forbiddenUsage).toBe("No competitor comparisons.");
      expect(updated.updatedByUserId).toBe(editor);
      expect(updated.createdByUserId).toBe(owner);

      const fetched = await profileRepo.findByClientOrganization(clientOrg);
      expect(fetched!.id).toBe(created.id);
    });

    it("scopes packages by tenant: client A's package is invisible to client B", async () => {
      const owner = await createUser("owner@example.test");
      const clientA = await createClientOrg(owner, "client-a", "Client A");
      const clientB = await createClientOrg(owner, "client-b", "Client B");
      const projectA = await createProject(clientA, owner, "Project A");

      const pkgRepo = new PgKnowledgePackageRepository(db);
      const pkg = await pkgRepo.create({
        clientOrganizationId: clientA,
        projectId: projectA,
        title: "Client A KB",
        createdByUserId: owner,
      });

      // Client A sees its package...
      const asA = await pkgRepo.listByProject(projectA, clientA);
      expect(asA.map((p) => p.id)).toContain(pkg.id);

      // ...client B, querying the same project, sees nothing (tenant filter).
      const asB = await pkgRepo.listByProject(projectA, clientB);
      expect(asB).toHaveLength(0);

      // getWithCounts is tenant-scoped too.
      expect(await pkgRepo.getWithCounts(pkg.id, clientB)).toBeNull();
      expect(await pkgRepo.getWithCounts(pkg.id, clientA)).not.toBeNull();
    });
  },
);
