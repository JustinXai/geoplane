/**
 * Real-Postgres route tests for BUSINESS_COMMAND_API_V1 (Agent C — batch 1).
 *
 * Exercises the command (write) + ops (read) App Router handlers end-to-end against
 * GEO_TEST_DATABASE_URL: seeds users/orgs/memberships through the real repositories, injects a
 * test auth runtime (shared by the command routes) via __setAuthRuntimeForTests, logs in to mint a
 * real session cookie, then invokes the exported handlers with `new Request(...)` and asserts HTTP
 * status + JSON + the actual persisted rows (organizations, assignments, projects, invitations,
 * audit_event).
 *
 * When no test database is configured the whole suite skips cleanly (describe.skipIf).
 *
 * Coverage:
 *   - PLATFORM creates agency -> client -> assignment -> project -> invitation (all persisted +
 *     one ALLOWED audit row per command; invitation stores the token HASH only).
 *   - a non-platform caller hitting an ops write route -> 403 FORBIDDEN + a DENIED audit row.
 *   - the same Idempotency-Key twice -> exactly ONE entity (and the same DTO replayed).
 *   - a command that smuggles a foreign organizationId in the body is ignored (the server uses the
 *     session's own tenant).
 *   - an AGENCY_OWNER provisions a managed client + assignment, then creates a project for it;
 *     creating a project for an UNassigned client -> 403 + DENIED audit.
 *   - GET /api/ops/organizations and GET /api/ops/audit return the right DTOs for platform and 403
 *     for a non-platform caller.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import { POST as loginRoute } from "../../../src/app/api/auth/login/route.js";
import { POST as opsAgenciesRoute } from "../../../src/app/api/ops/agencies/route.js";
import { POST as opsClientsRoute } from "../../../src/app/api/ops/clients/route.js";
import { POST as opsAssignmentsRoute } from "../../../src/app/api/ops/assignments/route.js";
import { GET as opsOrganizationsRoute } from "../../../src/app/api/ops/organizations/route.js";
import { GET as opsAuditRoute } from "../../../src/app/api/ops/audit/route.js";
import { POST as agencyClientsRoute } from "../../../src/app/api/commands/agency/clients/route.js";
import { POST as projectsRoute } from "../../../src/app/api/commands/projects/route.js";
import { POST as invitationsRoute } from "../../../src/app/api/projects/[projectId]/invitations/route.js";

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

/** Seeds a platform super-admin and returns { cookie, userId, orgId }. */
async function seedPlatformAdmin(
  suffix: string,
): Promise<{ cookie: string; userId: string; orgId: string }> {
  const email = `platform-${suffix}@example.test`;
  const userId = await createUser(email);
  const orgId = await createOrg("PLATFORM", `platform-${suffix}`, `Platform ${suffix}`, userId);
  await createMembership(userId, orgId, "PLATFORM_SUPER_ADMIN");
  const cookie = await loginAndGetCookie(email);
  return { cookie, userId, orgId };
}

function jsonRequest(url: string, cookie: string, body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe.skipIf(testConfig === null)("BUSINESS_COMMAND_API_V1 — command + ops routes over real Postgres", () => {
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

  it("PLATFORM creates agency -> client -> assignment -> project -> invitation (all persisted + audit)", async () => {
    const admin = await seedPlatformAdmin("main");

    // 1. Create an AGENCY org.
    const agencyRes = await opsAgenciesRoute(
      jsonRequest("http://test/api/ops/agencies", admin.cookie, { displayName: "Acme Agency" }),
    );
    expect(agencyRes.status).toBe(200);
    const agencyBody = await agencyRes.json();
    expect(agencyBody.ok).toBe(true);
    expect(agencyBody.data.type).toBe("AGENCY");
    const agencyId: string = agencyBody.data.id;

    // 2. Create a CLIENT org.
    const clientRes = await opsClientsRoute(
      jsonRequest("http://test/api/ops/clients", admin.cookie, { displayName: "Beta Client" }),
    );
    expect(clientRes.status).toBe(200);
    const clientBody = await clientRes.json();
    expect(clientBody.data.type).toBe("CLIENT");
    const clientId: string = clientBody.data.id;

    // 3. Assign the agency to the client.
    const assignRes = await opsAssignmentsRoute(
      jsonRequest("http://test/api/ops/assignments", admin.cookie, {
        agencyOrganizationId: agencyId,
        clientOrganizationId: clientId,
      }),
    );
    expect(assignRes.status).toBe(200);
    const assignBody = await assignRes.json();
    expect(assignBody.data.status).toBe("ACTIVE");
    expect(assignBody.data.agencyOrganizationId).toBe(agencyId);
    expect(assignBody.data.clientOrganizationId).toBe(clientId);

    // 4. Create a project under the client.
    const projectRes = await projectsRoute(
      jsonRequest("http://test/api/commands/projects", admin.cookie, {
        name: "Launch Content",
        clientOrganizationId: clientId,
      }),
    );
    expect(projectRes.status).toBe(200);
    const projectBody = await projectRes.json();
    expect(projectBody.data.clientOrganizationId).toBe(clientId);
    const projectId: string = projectBody.data.id;

    // 5. Invite a client owner to the project.
    const inviteRes = await invitationsRoute(
      jsonRequest(`http://test/api/projects/${projectId}/invitations`, admin.cookie, {
        invitedEmail: "owner@beta.test",
      }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(inviteRes.status).toBe(200);
    const inviteBody = await inviteRes.json();
    expect(inviteBody.data.status).toBe("PENDING");
    expect(inviteBody.data.role).toBe("CLIENT_OWNER");
    expect(inviteBody.data.organizationId).toBe(clientId);
    // The DTO must never carry the raw token or its hash.
    expect(inviteBody.data.token).toBeUndefined();
    expect(inviteBody.data.tokenHash).toBeUndefined();
    const invitationId: string = inviteBody.data.id;

    // --- Persistence assertions -------------------------------------------------------------
    const orgCount = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization WHERE type IN ('AGENCY','CLIENT')`,
    );
    expect(orgCount.rows[0]!.n).toBe("2");

    const assignRows = await db.query<{ status: string }>(
      `SELECT status FROM agency_client_assignment
       WHERE agency_organization_id = $1 AND client_organization_id = $2`,
      [agencyId, clientId],
    );
    expect(assignRows.rows).toHaveLength(1);
    expect(assignRows.rows[0]!.status).toBe("ACTIVE");

    const projRows = await db.query<{ client_organization_id: string }>(
      `SELECT client_organization_id FROM project WHERE id = $1`,
      [projectId],
    );
    expect(projRows.rows).toHaveLength(1);
    expect(projRows.rows[0]!.client_organization_id).toBe(clientId);

    // Invitation persists the token HASH only (64-hex sha256), never a raw token.
    const invRows = await db.query<{ status: string; token_hash: string; role: string; organization_id: string }>(
      `SELECT status, token_hash, role, organization_id FROM invitation WHERE id = $1`,
      [invitationId],
    );
    expect(invRows.rows).toHaveLength(1);
    expect(invRows.rows[0]!.status).toBe("PENDING");
    expect(invRows.rows[0]!.role).toBe("CLIENT_OWNER");
    expect(invRows.rows[0]!.organization_id).toBe(clientId);
    expect(invRows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    // One ALLOWED audit row per command, all by the real platform actor.
    const audit = await db.query<{ action: string; outcome: string }>(
      `SELECT action, metadata->>'outcome' AS outcome FROM audit_event
       WHERE actor_user_id = $1 ORDER BY created_at`,
      [admin.userId],
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toEqual([
      "ops.agency.create",
      "ops.client.create",
      "ops.assignment.create",
      "project.create",
      "project.invitation.create",
    ]);
    expect(audit.rows.every((r) => r.outcome === "ALLOWED")).toBe(true);
  });

  it("a non-platform caller hitting an ops write route -> 403 + a DENIED audit row", async () => {
    const userId = await createUser("client-owner@example.test");
    const orgId = await createOrg("CLIENT", "co-client", "CO Client", userId);
    await createMembership(userId, orgId, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("client-owner@example.test");

    const res = await opsAgenciesRoute(
      jsonRequest("http://test/api/ops/agencies", cookie, { displayName: "Sneaky Agency" }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");

    // No agency was created.
    const agencyCount = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization WHERE type = 'AGENCY'`,
    );
    expect(agencyCount.rows[0]!.n).toBe("0");

    // A DENIED audit row records the real denied actor.
    const audit = await db.query<{ outcome: string }>(
      `SELECT metadata->>'outcome' AS outcome FROM audit_event
       WHERE actor_user_id = $1 AND action = 'ops.agency.create'`,
      [userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.outcome).toBe("DENIED");
  });

  it("the same Idempotency-Key twice -> exactly ONE entity (and the same DTO replayed)", async () => {
    const admin = await seedPlatformAdmin("idem");

    const makeReq = () =>
      opsClientsRoute(
        jsonRequest(
          "http://test/api/ops/clients",
          admin.cookie,
          { displayName: "Idempotent Client" },
          { "idempotency-key": "idem-key-abc-123" },
        ),
      );

    const firstBody = await (await makeReq()).json();
    const secondBody = await (await makeReq()).json();

    expect(firstBody.data.id).toBe(secondBody.data.id);

    // Exactly one CLIENT organization was created for that key.
    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization WHERE type = 'CLIENT' AND display_name = 'Idempotent Client'`,
    );
    expect(count.rows[0]!.n).toBe("1");

    // The retry replayed, so exactly one ALLOWED audit row exists for that key.
    const audit = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_event
       WHERE action = 'ops.client.create' AND metadata->>'idempotencyKey' = 'idem-key-abc-123'`,
    );
    expect(audit.rows[0]!.n).toBe("1");
  });

  it("a smuggled foreign organizationId in the body is ignored (server uses the session's own tenant)", async () => {
    // A client owner pinned to their own client org.
    const ownerUser = await createUser("pinned-owner@example.test");
    const ownClientOrg = await createOrg("CLIENT", "own-client", "Own Client", ownerUser);
    await createMembership(ownerUser, ownClientOrg, "CLIENT_OWNER");
    const cookie = await loginAndGetCookie("pinned-owner@example.test");

    // A foreign client org the caller must never be able to target.
    const foreignClientOrg = await createOrg("CLIENT", "foreign-client", "Foreign Client", ownerUser);

    const res = await projectsRoute(
      jsonRequest("http://test/api/commands/projects", cookie, {
        name: "Smuggle Attempt",
        clientOrganizationId: foreignClientOrg, // must be ignored
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Server resolved the tenant from the session, NOT the body.
    expect(body.data.clientOrganizationId).toBe(ownClientOrg);
    expect(body.data.clientOrganizationId).not.toBe(foreignClientOrg);

    // The project row is under the caller's own org; nothing was created under the foreign org.
    const foreignProjects = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project WHERE client_organization_id = $1`,
      [foreignClientOrg],
    );
    expect(foreignProjects.rows[0]!.n).toBe("0");
  });

  it("an AGENCY_OWNER provisions a managed client + assignment, then creates a project for it", async () => {
    const agencyUser = await createUser("agency-owner@example.test");
    const agencyOrg = await createOrg("AGENCY", "prov-agency", "Provisioning Agency", agencyUser);
    await createMembership(agencyUser, agencyOrg, "AGENCY_OWNER");
    const cookie = await loginAndGetCookie("agency-owner@example.test");

    // Provision a managed client (creates CLIENT org + ACTIVE assignment atomically).
    const provRes = await agencyClientsRoute(
      jsonRequest("http://test/api/commands/agency/clients", cookie, { displayName: "Managed Client" }),
    );
    expect(provRes.status).toBe(200);
    const provBody = await provRes.json();
    expect(provBody.data.client.type).toBe("CLIENT");
    expect(provBody.data.assignment.status).toBe("ACTIVE");
    expect(provBody.data.assignment.agencyOrganizationId).toBe(agencyOrg);
    const managedClientId: string = provBody.data.client.id;

    // The assignment is persisted and ACTIVE.
    const authorized = await runtime.repos.agencyClientAssignments.isAuthorized(
      agencyOrg,
      managedClientId,
    );
    expect(authorized).toBe(true);

    // The agency can now create a project for its newly-managed client (session re-derives grants).
    const projRes = await projectsRoute(
      jsonRequest("http://test/api/commands/projects", cookie, {
        name: "Managed Project",
        clientOrganizationId: managedClientId,
      }),
    );
    expect(projRes.status).toBe(200);
    const projBody = await projRes.json();
    expect(projBody.data.clientOrganizationId).toBe(managedClientId);
  });

  it("an AGENCY_OWNER creating a project for an UNassigned client -> 403 + DENIED audit", async () => {
    const agencyUser = await createUser("agency-owner2@example.test");
    const agencyOrg = await createOrg("AGENCY", "unassigned-agency", "Unassigned Agency", agencyUser);
    await createMembership(agencyUser, agencyOrg, "AGENCY_OWNER");
    const cookie = await loginAndGetCookie("agency-owner2@example.test");

    // A client the agency is NOT assigned to.
    const strangerClient = await createOrg("CLIENT", "stranger-client", "Stranger Client", agencyUser);

    const res = await projectsRoute(
      jsonRequest("http://test/api/commands/projects", cookie, {
        name: "Cross-tenant Project",
        clientOrganizationId: strangerClient,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");

    const projects = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM project WHERE client_organization_id = $1`,
      [strangerClient],
    );
    expect(projects.rows[0]!.n).toBe("0");

    const audit = await db.query<{ outcome: string }>(
      `SELECT metadata->>'outcome' AS outcome FROM audit_event
       WHERE actor_user_id = $1 AND action = 'project.create'`,
      [agencyUser],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.outcome).toBe("DENIED");
  });

  it("GET /api/ops/organizations returns the org directory for platform, 403 for others", async () => {
    const admin = await seedPlatformAdmin("orglist");
    await createOrg("AGENCY", "listed-agency", "Listed Agency", admin.userId);
    await createOrg("CLIENT", "listed-client", "Listed Client", admin.userId);

    const okRes = await opsOrganizationsRoute(
      new Request("http://test/api/ops/organizations", { headers: { cookie: admin.cookie } }),
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.ok).toBe(true);
    // platform org + agency + client = 3
    expect(okBody.data.length).toBe(3);
    const types = okBody.data.map((o: { type: string }) => o.type).sort();
    expect(types).toEqual(["AGENCY", "CLIENT", "PLATFORM"]);

    // A non-platform caller is forbidden.
    const clientUser = await createUser("orglist-client@example.test");
    const clientOrg = await createOrg("CLIENT", "orglist-co", "OrgList CO", clientUser);
    await createMembership(clientUser, clientOrg, "CLIENT_OWNER");
    const clientCookie = await loginAndGetCookie("orglist-client@example.test");

    const forbidden = await opsOrganizationsRoute(
      new Request("http://test/api/ops/organizations", { headers: { cookie: clientCookie } }),
    );
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
  });

  it("GET /api/ops/audit returns AuditEventViewV1[] for platform, 403 for others", async () => {
    const admin = await seedPlatformAdmin("auditlist");

    // Generate an audit row via a real command.
    await opsAgenciesRoute(
      jsonRequest("http://test/api/ops/agencies", admin.cookie, { displayName: "Audited Agency" }),
    );

    const okRes = await opsAuditRoute(
      new Request("http://test/api/ops/audit", { headers: { cookie: admin.cookie } }),
    );
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.ok).toBe(true);
    expect(okBody.data.length).toBeGreaterThanOrEqual(1);
    const event = okBody.data[0];
    // AuditEventViewV1 shape (presentation view-model; no internal fields).
    expect(event).toHaveProperty("id");
    expect(event).toHaveProperty("action");
    expect(event).toHaveProperty("actorDisplayName");
    expect(event).toHaveProperty("occurredAt");
    expect(event).not.toHaveProperty("eventHash");
    expect(event).not.toHaveProperty("metadata");
    expect(event.actorDisplayName).toBe("platform-auditlist@example.test");

    // A non-platform caller is forbidden.
    const clientUser = await createUser("auditlist-client@example.test");
    const clientOrg = await createOrg("CLIENT", "auditlist-co", "AuditList CO", clientUser);
    await createMembership(clientUser, clientOrg, "CLIENT_OWNER");
    const clientCookie = await loginAndGetCookie("auditlist-client@example.test");

    const forbidden = await opsAuditRoute(
      new Request("http://test/api/ops/audit", { headers: { cookie: clientCookie } }),
    );
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
  });
});
