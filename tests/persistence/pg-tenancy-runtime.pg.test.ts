/**
 * Real-Postgres persistence tests for POSTGRES_RUNTIME_V1.
 *
 * These run against GEO_TEST_DATABASE_URL (a throwaway database). When no test database is
 * configured (e.g. CI without Postgres), the whole suite skips cleanly rather than failing —
 * the DB-less 221-test suite is unaffected. Where a database IS available, these prove the
 * three database-enforced tenancy invariants for real, not in application code:
 *   1. same idempotency key, 10 concurrent creates  -> exactly one organization
 *   2. a second ACTIVE CLIENT membership for a user  -> rejected (partial unique index)
 *   3. UPDATE / DELETE on artifact_index            -> rejected (append-only triggers)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { PgArtifactIndexRepository } from "../../src/persistence/pg/artifact-index-repository.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { PgMembershipRepository } from "../../src/persistence/pg/membership-repository.js";
import { PgOrganizationRepository } from "../../src/persistence/pg/organization-repository.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

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

describe.skipIf(testConfig === null)("POSTGRES_RUNTIME_V1 — real database invariants", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 10 });
    await applyMigrations(db, migrationsDir);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE artifact_index, membership, project, organization, "user" RESTART IDENTITY CASCADE`,
    );
  });

  it("collapses 10 concurrent same-key creates into exactly one organization", async () => {
    const creator = await createUser("creator@example.test");
    const repo = new PgOrganizationRepository(db);
    const key = "idem-concurrent-key-001";

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.createIdempotent({
          type: "AGENCY",
          displayName: "Concurrent Agency",
          idempotencyKey: key,
          createdByUserId: creator,
        }),
      ),
    );

    const distinctIds = new Set(results.map((o) => o.id));
    expect(distinctIds.size).toBe(1);
    expect(await repo.countByIdempotencyKey(key)).toBe(1);
  });

  it("rejects a user's second ACTIVE CLIENT-organization membership", async () => {
    const creator = await createUser("platform-admin@example.test");
    const clientUser = await createUser("client-owner@example.test");
    const orgRepo = new PgOrganizationRepository(db);
    const memberRepo = new PgMembershipRepository(db);

    const clientA = await orgRepo.createIdempotent({
      type: "CLIENT",
      displayName: "Client A",
      idempotencyKey: "client-a",
      createdByUserId: creator,
    });
    const clientB = await orgRepo.createIdempotent({
      type: "CLIENT",
      displayName: "Client B",
      idempotencyKey: "client-b",
      createdByUserId: creator,
    });

    // First active client membership: allowed.
    await memberRepo.create({
      userId: clientUser,
      organizationId: clientA.id,
      role: "CLIENT_OWNER",
    });

    // Second active client membership for the same user: DB rejects.
    await expect(
      memberRepo.create({
        userId: clientUser,
        organizationId: clientB.id,
        role: "CLIENT_OWNER",
      }),
    ).rejects.toMatchObject({ code: "23505" });

    // The user still has exactly one active membership.
    expect(await memberRepo.listActiveByUser(clientUser)).toHaveLength(1);
  });

  it("forbids UPDATE and DELETE on the append-only artifact_index", async () => {
    const creator = await createUser("ops@example.test");
    const orgRepo = new PgOrganizationRepository(db);
    const client = await orgRepo.createIdempotent({
      type: "CLIENT",
      displayName: "Client With Artifacts",
      idempotencyKey: "client-artifacts",
      createdByUserId: creator,
    });
    const projectId = await createProject(client.id, creator, "Project One");

    const artifactRepo = new PgArtifactIndexRepository(db);
    const artifact = await artifactRepo.append({
      artifactType: "ARTICLE_DRAFT",
      artifactId: "11111111-1111-1111-1111-111111111111",
      clientOrganizationId: client.id,
      projectId,
      artifactVersion: 1,
      storagePath: "sealed/article-draft/v1",
      sealedAt: "2026-07-18T00:00:00.000Z",
      contentHash: "deadbeef",
    });

    await expect(
      db.query(`UPDATE artifact_index SET storage_path = 'tampered' WHERE id = $1`, [artifact.id]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.query(`DELETE FROM artifact_index WHERE id = $1`, [artifact.id]),
    ).rejects.toThrow(/append-only/i);

    // The sealed row is still intact and unchanged.
    const stillThere = await artifactRepo.listByProject(projectId);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.storagePath).toBe("sealed/article-draft/v1");
  });
});
