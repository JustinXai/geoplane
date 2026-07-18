/**
 * SESSION_ROTATION_AND_REVOCATION_V1 (part 2) — server-side revocation + staleness, over real
 * Postgres (GEO_TEST_DATABASE_URL / geoplane_pl_b).
 *
 * resolveSession must, after the cookie's signature + absolute-TTL pass, load the persisted session
 * row and reject it when it is revoked, expired, idle-timed-out, stale (session_version behind the
 * membership's live counter), or presented for a different organization / workspace surface than it
 * was issued for. A still-cryptographically-valid cookie must NOT be able to bypass any of these.
 *
 * Each test seeds a user + org + membership + session directly (the session row is inserted with
 * full control over session_version / created_at / expires_at / revoked_at, since the checkpoint may
 * not add columns), builds a validly-signed cookie for it, and asserts the resolveSession verdict.
 * When no test database is configured the whole suite skips cleanly.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import type { PlatformRole } from "../../../src/contracts/tenancy/entities.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import {
  createAuthRuntime,
  __setAuthRuntimeForTests,
  type AuthRuntime,
} from "../../../src/runtime/auth/runtime-context.js";
import {
  SESSION_COOKIE_NAME,
  encodeSessionCookie,
  type AcceptanceSessionCookiePayload,
} from "../../../src/lib/session-cookie.js";
import { signSessionCookieValue } from "../../../src/lib/session-signing.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

let db: DatabasePort;
let runtime: AuthRuntime;

const HOUR = 60 * 60 * 1000;

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
  createdBy: string,
): Promise<string> {
  const org = await runtime.repos.organizations.createIdempotent({
    type,
    displayName: key,
    idempotencyKey: key,
    createdByUserId: createdBy,
  });
  return org.id;
}

interface SeedSessionInput {
  readonly userId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly role: PlatformRole;
  readonly activeClientOrganizationId?: string | null;
  readonly sessionVersion: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt?: Date | null;
}

/** Inserts a session row with full control over version/timestamps/revocation. Returns its id. */
async function seedSession(input: SeedSessionInput): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO session
       (user_id, membership_id, organization_id, role, active_client_organization_id,
        active_project_id, session_version, created_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.userId,
      input.membershipId,
      input.organizationId,
      input.role,
      input.activeClientOrganizationId ?? null,
      input.sessionVersion,
      input.createdAt,
      input.expiresAt,
      input.revokedAt ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error("session insert returned no row");
  return row.id;
}

/** A CLIENT_OWNER + org + ACTIVE membership. Returns the ids the session seeder needs. */
async function setupClient(
  email: string,
  orgKey: string,
): Promise<{ userId: string; orgId: string; membershipId: string }> {
  const userId = await createUser(email);
  const orgId = await createOrg("CLIENT", orgKey, userId);
  const membership = await runtime.repos.memberships.create({
    userId,
    organizationId: orgId,
    role: "CLIENT_OWNER",
  });
  return { userId, orgId, membershipId: membership.id };
}

function clientPayload(userId: string, orgId: string): AcceptanceSessionCookiePayload {
  return {
    actorUserId: userId,
    role: "CLIENT_OWNER",
    organizationId: orgId,
    organizationType: "CLIENT",
    activeClientOrganizationId: orgId,
  };
}

/** A ready-to-send Cookie header for a freshly-signed cookie carrying `payload`. */
function cookieHeader(payload: AcceptanceSessionCookiePayload): string {
  return `${SESSION_COOKIE_NAME}=${encodeSessionCookie(payload)}`;
}

describe.skipIf(testConfig === null)(
  "SESSION_ROTATION_AND_REVOCATION_V1 — resolveSession revocation + staleness over real Postgres",
  () => {
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

    it("resolves a valid current session to a principal (baseline)", async () => {
      const { userId, orgId, membershipId } = await setupClient("valid@pl-b.test", "valid-client");
      const now = Date.now();
      const sessionId = await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      const principal = await runtime.resolveSession(cookieHeader(clientPayload(userId, orgId)));
      expect(principal).not.toBeNull();
      expect(principal?.userId).toBe(userId);
      expect(principal?.organizationId).toBe(orgId);
      expect(principal?.role).toBe("CLIENT_OWNER");
      // resolveSession surfaces the real DB row id (the id logout must revoke).
      expect(principal?.sessionId).toBe(sessionId);
    });

    it("rejects a revoked session even with a cryptographically valid cookie", async () => {
      const { userId, orgId, membershipId } = await setupClient("revoked@pl-b.test", "revoked-client");
      const now = Date.now();
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
        revokedAt: new Date(now - 30_000),
      });

      const principal = await runtime.resolveSession(cookieHeader(clientPayload(userId, orgId)));
      expect(principal).toBeNull();
    });

    it("revoking through PgSessionRepository.revoke turns a previously-valid session to null", async () => {
      const { userId, orgId, membershipId } = await setupClient("revokepath@pl-b.test", "revokepath-client");
      const now = Date.now();
      const sessionId = await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      const header = cookieHeader(clientPayload(userId, orgId));
      // Valid before revocation.
      expect(await runtime.resolveSession(header)).not.toBeNull();

      // The revoke PATH (PgSessionRepository.revoke, via the runtime's repositories).
      await runtime.repos.sessions.revoke(sessionId);

      // The SAME still-cryptographically-valid cookie no longer resolves.
      expect(await runtime.resolveSession(header)).toBeNull();
    });

    it("rejects a session whose session_version is behind the membership's live counter (stale)", async () => {
      const { userId, orgId, membershipId } = await setupClient("stale@pl-b.test", "stale-client");
      const now = Date.now();

      // A higher-version session was issued for this membership (authorization facts advanced to v2).
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 2,
        createdAt: new Date(now - 2 * HOUR),
        expiresAt: new Date(now + 12 * HOUR),
      });
      // The session the cookie represents is the newest ACTIVE one but was issued at v1 — behind
      // the live high-water mark (v2) — so it is stale even though not revoked or expired.
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      const principal = await runtime.resolveSession(cookieHeader(clientPayload(userId, orgId)));
      expect(principal).toBeNull();
    });

    it("rejects an expired session row (past expires_at) even with a fresh cookie", async () => {
      const { userId, orgId, membershipId } = await setupClient("expired@pl-b.test", "expired-client");
      const now = Date.now();
      // Row expired an hour ago (constraint still satisfied: expires_at > created_at). The cookie
      // itself is freshly signed, so only the server-side row expiry rejects it.
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 3 * HOUR),
        expiresAt: new Date(now - HOUR),
      });

      const principal = await runtime.resolveSession(cookieHeader(clientPayload(userId, orgId)));
      expect(principal).toBeNull();
    });

    it("rejects an idle session (cookie issuedAt older than the idle window) while its TTL still holds", async () => {
      const { userId, orgId, membershipId } = await setupClient("idle@pl-b.test", "idle-client");
      const now = Date.now();
      // A perfectly valid, non-revoked, non-expired, current session row.
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 40 * 60 * 1000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      // A cookie signed 40 minutes ago (issuedAt in the past): its absolute 12h TTL has not
      // elapsed, but it is beyond the 30-minute idle window.
      const payloadSeg = Buffer.from(JSON.stringify(clientPayload(userId, orgId)), "utf8").toString(
        "base64url",
      );
      const idleValue = signSessionCookieValue(payloadSeg, { now: now - 40 * 60 * 1000 });
      const principal = await runtime.resolveSession(`${SESSION_COOKIE_NAME}=${idleValue}`);
      expect(principal).toBeNull();
    });

    it("rejects a cookie presented for a different organization than it was issued for (cross-org)", async () => {
      const { userId, orgId, membershipId } = await setupClient("crossorg@pl-b.test", "crossorg-client");
      const now = Date.now();
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      // A different organization the user holds NO session in.
      const otherOrgId = await createOrg("CLIENT", "crossorg-other", userId);
      const crossOrgPayload: AcceptanceSessionCookiePayload = {
        ...clientPayload(userId, orgId),
        organizationId: otherOrgId,
        activeClientOrganizationId: otherOrgId,
      };

      const principal = await runtime.resolveSession(cookieHeader(crossOrgPayload));
      expect(principal).toBeNull();
    });

    it("rejects a cookie whose role maps to a different workspace surface than the session (cross-surface)", async () => {
      const { userId, orgId, membershipId } = await setupClient("crosssurface@pl-b.test", "crosssurface-client");
      const now = Date.now();
      // The server session is a CLIENT_OWNER (surface "app").
      await seedSession({
        userId,
        membershipId,
        organizationId: orgId,
        role: "CLIENT_OWNER",
        activeClientOrganizationId: orgId,
        sessionVersion: 1,
        createdAt: new Date(now - 60_000),
        expiresAt: new Date(now + 12 * HOUR),
      });

      // A validly-signed cookie that asserts an AGENCY_OWNER role (surface "agency") for the same
      // org — the surfaces disagree, so it must be rejected.
      const crossSurfacePayload: AcceptanceSessionCookiePayload = {
        ...clientPayload(userId, orgId),
        role: "AGENCY_OWNER",
      };

      const principal = await runtime.resolveSession(cookieHeader(crossSurfacePayload));
      expect(principal).toBeNull();
    });
  },
);
