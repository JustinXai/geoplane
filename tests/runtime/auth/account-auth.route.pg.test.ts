/**
 * Real-Postgres route tests for ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 *
 * These exercise the App Router route handlers end-to-end against GEO_TEST_DATABASE_URL: they
 * seed users/orgs/memberships/assignments/invitations through the real repositories, inject a
 * test auth runtime (pointed at the throwaway test database) via __setAuthRuntimeForTests, then
 * invoke the exported GET/POST handlers with a `new Request(...)` and assert HTTP status + JSON.
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 *
 * Coverage:
 *   - login returns AccountViewV1 + Set-Cookie
 *   - GET /api/account unauthenticated -> 401
 *   - a CLIENT role cannot reach GET /api/agency/clients -> 403
 *   - agency selecting an unauthorized client via POST /api/agency/context -> 403 + audit row
 *   - POST /api/invitations/[token]/accept happy path, and expired/revoked -> 409
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { hashInvitationToken } from "../../../src/contracts/tenancy/invitations.js";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { GET as accountRoute } from "../../../src/app/api/account/route.js";
import { GET as agencyClientsRoute } from "../../../src/app/api/agency/clients/route.js";
import { POST as agencyContextRoute } from "../../../src/app/api/agency/context/route.js";
import { POST as acceptInvitationRoute } from "../../../src/app/api/invitations/[token]/accept/route.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

let db: DatabasePort;
let runtime: AuthRuntime;

// --- seed helpers -----------------------------------------------------------

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createOrg(
  type: "AGENCY" | "CLIENT" | "PLATFORM",
  key: string,
  name: string,
  createdBy: string,
): Promise<string> {
  const org = await runtime.repos.organizations.createIdempotent({
    type,
    displayName: name,
    idempotencyKey: key,
    createdByUserId: createdBy,
  });
  return org.id;
}

async function createMembership(
  userId: string,
  organizationId: string,
  role: PlatformRole,
): Promise<void> {
  await runtime.repos.memberships.create({ userId, organizationId, role });
}

/** Runs login for `email` and returns the reusable `name=value` Cookie header value. */
async function loginAndGetCookie(email: string): Promise<string> {
  const res = await loginRoute(
    new Request("http://test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a cookie");
  return setCookie.split(";")[0]!;
}

describe.skipIf(testConfig === null)("ACCOUNT_AUTH_RUNTIME_V1 — routes over real Postgres", () => {
  beforeAll(async () => {
    db = createPgDatabase({ connectionString: testConfig!.connectionString, max: 8 });
    await applyMigrations(db, migrationsDir);
    runtime = createAuthRuntime(db);
    __setAuthRuntimeForTests(runtime);
  });

  afterAll(async () => {
    __setAuthRuntimeForTests(null);
    if (db) await db.close();
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE audit_event, session, invitation, agency_client_assignment,
                membership, project, organization, "user"
       RESTART IDENTITY CASCADE`,
    );
  });

  it("POST /api/auth/login returns AccountViewV1 + Set-Cookie", async () => {
    const userId = await createUser("owner@example.test");
    const orgId = await createOrg("CLIENT", "client-a", "Client A", userId);
    await createMembership(userId, orgId, "CLIENT_OWNER");

    const res = await loginRoute(
      new Request("http://test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test" }),
      }),
    );

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("geo_acceptance_session=");
    expect(setCookie).toContain("HttpOnly");

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      userId,
      email: "owner@example.test",
      role: "CLIENT_OWNER",
      surface: "client",
      organizationId: orgId,
      organizationName: "Client A",
      organizationType: "CLIENT",
      activeClientOrganizationId: orgId,
    });
  });

  it("GET /api/account unauthenticated -> 401", async () => {
    const res = await accountRoute(new Request("http://test/api/account"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("GET /api/account authenticated returns the account view", async () => {
    const userId = await createUser("acct@example.test");
    const orgId = await createOrg("CLIENT", "client-acct", "Acct Client", userId);
    await createMembership(userId, orgId, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("acct@example.test");

    const res = await accountRoute(
      new Request("http://test/api/account", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.userId).toBe(userId);
    expect(body.data.organizationId).toBe(orgId);
  });

  it("a CLIENT role cannot reach GET /api/agency/clients -> 403", async () => {
    const userId = await createUser("client@example.test");
    const orgId = await createOrg("CLIENT", "client-b", "Client B", userId);
    await createMembership(userId, orgId, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("client@example.test");

    const res = await agencyClientsRoute(
      new Request("http://test/api/agency/clients", { headers: { cookie } }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("an agency lists only its ACTIVE-assigned clients via GET /api/agency/clients", async () => {
    const agencyUser = await createUser("agency@example.test");
    const agencyOrg = await createOrg("AGENCY", "agency-a", "Agency A", agencyUser);
    await createMembership(agencyUser, agencyOrg, "AGENCY_OWNER");
    const clientOrg = await createOrg("CLIENT", "client-assigned", "Assigned Client", agencyUser);
    await runtime.repos.agencyClientAssignments.assign({
      agencyOrganizationId: agencyOrg,
      clientOrganizationId: clientOrg,
      assignedByUserId: agencyUser,
    });
    const cookie = await loginAndGetCookie("agency@example.test");

    const res = await agencyClientsRoute(
      new Request("http://test/api/agency/clients", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.agencyOrganizationId).toBe(agencyOrg);
    expect(body.data.clients).toHaveLength(1);
    expect(body.data.clients[0].clientOrganizationId).toBe(clientOrg);
  });

  it("agency selecting an unauthorized client via POST /api/agency/context -> 403 + audit row", async () => {
    const agencyUser = await createUser("agency2@example.test");
    const agencyOrg = await createOrg("AGENCY", "agency-c", "Agency C", agencyUser);
    await createMembership(agencyUser, agencyOrg, "AGENCY_OWNER");
    // A client org the agency is NOT assigned to.
    const strangerClient = await createOrg("CLIENT", "client-stranger", "Stranger Client", agencyUser);
    const cookie = await loginAndGetCookie("agency2@example.test");

    const res = await agencyContextRoute(
      new Request("http://test/api/agency/context", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ clientOrganizationId: strangerClient }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");

    const audit = await db.query<{ action: string; target_id: string; metadata: unknown }>(
      `SELECT action, target_id, metadata FROM audit_event
       WHERE actor_organization_id = $1 AND action = 'access-context-changed'`,
      [agencyOrg],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.target_id).toBe(strangerClient);
    expect((audit.rows[0]!.metadata as { outcome?: string }).outcome).toBe("DENIED");
  });

  it("agency selecting an ACTIVE-assigned client via POST /api/agency/context -> 200 + ALLOWED audit", async () => {
    const agencyUser = await createUser("agency3@example.test");
    const agencyOrg = await createOrg("AGENCY", "agency-d", "Agency D", agencyUser);
    await createMembership(agencyUser, agencyOrg, "AGENCY_OWNER");
    const clientOrg = await createOrg("CLIENT", "client-ok", "OK Client", agencyUser);
    await runtime.repos.agencyClientAssignments.assign({
      agencyOrganizationId: agencyOrg,
      clientOrganizationId: clientOrg,
      assignedByUserId: agencyUser,
    });
    const cookie = await loginAndGetCookie("agency3@example.test");

    const res = await agencyContextRoute(
      new Request("http://test/api/agency/context", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ clientOrganizationId: clientOrg }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.actingClientOrganizationId).toBe(clientOrg);

    const audit = await db.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_event WHERE actor_organization_id = $1`,
      [agencyOrg],
    );
    expect(audit.rows).toHaveLength(1);
    expect((audit.rows[0]!.metadata as { outcome?: string }).outcome).toBe("ALLOWED");
  });

  it("POST /api/invitations/[token]/accept happy path returns the invited account view", async () => {
    const invitee = await createUser("invitee@example.test");
    const homeOrg = await createOrg("CLIENT", "invitee-home", "Invitee Home", invitee);
    await createMembership(invitee, homeOrg, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("invitee@example.test");

    // Invitation into a different org, valid for 7 days.
    const inviterOrg = await createOrg("AGENCY", "inviter-agency", "Inviter Agency", invitee);
    const rawToken = "test-token-happy-0001";
    await runtime.repos.invitations.create({
      organizationId: inviterOrg,
      invitedEmail: "invitee@example.test",
      role: "AGENCY_OPERATOR",
      tokenHash: hashInvitationToken(rawToken),
      createdByUserId: invitee,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const res = await acceptInvitationRoute(
      new Request(`http://test/api/invitations/${rawToken}/accept`, {
        method: "POST",
        headers: { cookie },
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.role).toBe("AGENCY_OPERATOR");
    expect(body.data.organizationId).toBe(inviterOrg);
  });

  it("POST /api/invitations/[token]/accept on an expired invitation -> 409", async () => {
    const invitee = await createUser("expired@example.test");
    const homeOrg = await createOrg("CLIENT", "expired-home", "Expired Home", invitee);
    await createMembership(invitee, homeOrg, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("expired@example.test");

    const inviterOrg = await createOrg("AGENCY", "expired-inviter", "Expired Inviter", invitee);
    const rawToken = "test-token-expired-0001";
    await runtime.repos.invitations.create({
      organizationId: inviterOrg,
      invitedEmail: "expired@example.test",
      role: "AGENCY_OPERATOR",
      tokenHash: hashInvitationToken(rawToken),
      createdByUserId: invitee,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const res = await acceptInvitationRoute(
      new Request(`http://test/api/invitations/${rawToken}/accept`, {
        method: "POST",
        headers: { cookie },
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details.status).toBe("EXPIRED");
  });

  it("POST /api/invitations/[token]/accept on a revoked invitation -> 409", async () => {
    const invitee = await createUser("revoked@example.test");
    const homeOrg = await createOrg("CLIENT", "revoked-home", "Revoked Home", invitee);
    await createMembership(invitee, homeOrg, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("revoked@example.test");

    const inviterOrg = await createOrg("AGENCY", "revoked-inviter", "Revoked Inviter", invitee);
    const rawToken = "test-token-revoked-0001";
    const invitation = await runtime.repos.invitations.create({
      organizationId: inviterOrg,
      invitedEmail: "revoked@example.test",
      role: "AGENCY_OPERATOR",
      tokenHash: hashInvitationToken(rawToken),
      createdByUserId: invitee,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await runtime.repos.invitations.revoke(invitation.id, invitee);

    const res = await acceptInvitationRoute(
      new Request(`http://test/api/invitations/${rawToken}/accept`, {
        method: "POST",
        headers: { cookie },
      }),
      { params: Promise.resolve({ token: rawToken }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details.status).toBe("REVOKED");
  });

  it("GET /api/agency/clients unauthenticated -> 401", async () => {
    const res = await agencyClientsRoute(new Request("http://test/api/agency/clients"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});
