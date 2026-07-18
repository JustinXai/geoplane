/**
 * Real-Postgres tests for POSTGRES_RUNTIME_V1 checkpoint B2: the remaining repositories
 * (AgencyClientAssignment/Project/Invitation/Session/AuditEvent), the repository composition
 * factory, and the transaction boundary. Skips cleanly when no test DB is configured.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import {
  createRepositories,
  withRepositories,
  type Repositories,
} from "../../src/persistence/repository-factory.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

let db: DatabasePort;
let repos: Repositories;

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

describe.skipIf(testConfig === null)("POSTGRES_RUNTIME_V1 B2 — repositories + factory + tx", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
    await applyMigrations(db, migrationsDir);
    repos = createRepositories(db);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE audit_event, session, invitation, project, membership, artifact_index,
       agency_client_assignment, organization, "user" RESTART IDENTITY CASCADE`,
    );
  });

  it("authorizes an agency over a client only via an ACTIVE assignment row", async () => {
    const admin = await createUser("admin@example.test");
    const agency = await repos.organizations.createIdempotent({
      type: "AGENCY", displayName: "Agency", idempotencyKey: "agency-1", createdByUserId: admin,
    });
    const clientA = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client A", idempotencyKey: "client-a", createdByUserId: admin,
    });
    const clientB = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client B", idempotencyKey: "client-b", createdByUserId: admin,
    });

    await repos.agencyClientAssignments.assign({
      agencyOrganizationId: agency.id, clientOrganizationId: clientA.id, assignedByUserId: admin,
    });

    expect(await repos.agencyClientAssignments.isAuthorized(agency.id, clientA.id)).toBe(true);
    // Unauthorized client -> reject.
    expect(await repos.agencyClientAssignments.isAuthorized(agency.id, clientB.id)).toBe(false);
    expect(await repos.agencyClientAssignments.listActiveClientIds(agency.id)).toEqual([clientA.id]);

    // A second ACTIVE row for the same pair is rejected by the partial unique index.
    await expect(
      repos.agencyClientAssignments.assign({
        agencyOrganizationId: agency.id, clientOrganizationId: clientA.id, assignedByUserId: admin,
      }),
    ).rejects.toMatchObject({ code: "23505" });

    // After revoke, authorization is gone and re-assign is allowed.
    await repos.agencyClientAssignments.revoke(agency.id, clientA.id);
    expect(await repos.agencyClientAssignments.isAuthorized(agency.id, clientA.id)).toBe(false);
    await repos.agencyClientAssignments.assign({
      agencyOrganizationId: agency.id, clientOrganizationId: clientA.id, assignedByUserId: admin,
    });
    expect(await repos.agencyClientAssignments.isAuthorized(agency.id, clientA.id)).toBe(true);
  });

  it("scopes projects to their client organization", async () => {
    const admin = await createUser("admin2@example.test");
    const clientA = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client A", idempotencyKey: "c-a", createdByUserId: admin,
    });
    const clientB = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client B", idempotencyKey: "c-b", createdByUserId: admin,
    });
    const p1 = await repos.projects.create({ clientOrganizationId: clientA.id, name: "P1", createdByUserId: admin });
    await repos.projects.create({ clientOrganizationId: clientB.id, name: "P2", createdByUserId: admin });

    const forA = await repos.projects.listForClient(clientA.id);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.id).toBe(p1.id);
    expect(await repos.projects.findById(p1.id)).not.toBeNull();
  });

  it("runs an invitation through its lifecycle without leaking the raw token", async () => {
    const admin = await createUser("admin3@example.test");
    const org = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client", idempotencyKey: "inv-org", createdByUserId: admin,
    });
    const inv = await repos.invitations.create({
      organizationId: org.id, invitedEmail: "invitee@example.test", role: "CLIENT_OWNER",
      tokenHash: "hash-abc", createdByUserId: admin, expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(inv.status).toBe("PENDING");
    expect(inv.tokenHash).toBe("hash-abc");

    expect((await repos.invitations.findByTokenHash("hash-abc"))?.id).toBe(inv.id);
    const accepted = await repos.invitations.markAccepted(inv.id);
    expect(accepted?.status).toBe("ACCEPTED");
    // Accepting again does nothing (not PENDING anymore).
    expect(await repos.invitations.markAccepted(inv.id)).toBeNull();
  });

  it("creates and revokes sessions", async () => {
    const user = await createUser("sess@example.test");
    const org = await repos.organizations.createIdempotent({
      type: "CLIENT", displayName: "Client", idempotencyKey: "sess-org", createdByUserId: user,
    });
    const membership = await repos.memberships.create({
      userId: user, organizationId: org.id, role: "CLIENT_OWNER",
    });
    const session = await repos.sessions.create({
      userId: user, membershipId: membership.id, organizationId: org.id, role: "CLIENT_OWNER",
      activeClientOrganizationId: org.id, sessionVersion: 1, expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect((await repos.sessions.findById(session.id))?.id).toBe(session.id);
    expect(await repos.sessions.listActiveByUser(user)).toHaveLength(1);

    await repos.sessions.revoke(session.id);
    expect(await repos.sessions.listActiveByUser(user)).toHaveLength(0);
  });

  it("appends audit events and lists them by organization", async () => {
    const user = await createUser("audit@example.test");
    const org = await repos.organizations.createIdempotent({
      type: "PLATFORM", displayName: "Platform", idempotencyKey: "audit-org", createdByUserId: user,
    });
    await repos.auditEvents.append({
      organizationId: org.id, actorUserId: user, actorOrganizationId: org.id,
      action: "ORGANIZATION_CREATED", targetType: "organization", targetId: org.id,
      metadata: { note: "test" }, eventHash: "hash-1",
    });
    const events = await repos.auditEvents.listByOrganization(org.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("ORGANIZATION_CREATED");
    expect(events[0]?.metadata).toEqual({ note: "test" });
  });

  it("rolls the whole unit back when a transactional flow throws", async () => {
    const admin = await createUser("tx@example.test");
    await expect(
      withRepositories(db, async (r) => {
        await r.organizations.createIdempotent({
          type: "AGENCY", displayName: "Half-created", idempotencyKey: "tx-rollback", createdByUserId: admin,
        });
        throw new Error("boom after insert");
      }),
    ).rejects.toThrow(/boom after insert/);

    // The org must NOT have been persisted — the transaction rolled back.
    expect(await repos.organizations.countByIdempotencyKey("tx-rollback")).toBe(0);
  });
});
