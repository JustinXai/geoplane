/**
 * PROVIDER_EXECUTION_LEDGER_V1 (checkpoint D3) — real-Postgres persistence tests
 * for the controlled-provider execution ledger, backed by
 * migrations/0007_provider_ledger.sql and driven through PgProviderLedger.
 *
 * Runs against GEO_TEST_DATABASE_URL (a throwaway database). When no test
 * database is configured the whole suite skips cleanly, exactly like the other
 * `*.pg.test.ts` suites — the DB-less unit suites are unaffected.
 *
 * Proves, for real:
 *   1. migration 0007 applies via applyMigrations, and the `provider_execution`
 *      table has NO api-key / prompt / response / content column (only token
 *      COUNTS + metadata) — asserted against information_schema.
 *   2. a successful execution persists exactly one OK row with token counts.
 *   3. a failed execution persists exactly one ERROR row with an error_code and
 *      no token counts.
 *   4. idempotency-key dedupe: the same key yields exactly one row (the first
 *      write wins; a second write for the key is a no-op).
 *   5. append-only: UPDATE and DELETE against provider_execution are rejected.
 *   6. tenant/project scoping: client A's executions are invisible to client B.
 *   7. the D2 OpenAI-compatible adapter, wired to the ledger via asObserver()
 *      with a FAKE fetch (zero real network), lands a durable OK row — and the
 *      API key never reaches the persisted row.
 *   8. PROVIDER_IDENTITY_LEDGER_V1: the canonical identity columns (0008 —
 *      gateway_vendor / model_vendor / protocol) persist verbatim, are
 *      CHECK-constrained to the closed sets in identity.ts, must be declared on
 *      INSERT (backfill DEFAULTs dropped), and are equally append-only.
 *
 * ZERO REAL NETWORK: the one adapter test injects a fake fetch and additionally
 * spies the global fetch to assert it is never called.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDatabaseConfig } from "../../../src/persistence/config.js";
import type { DatabasePort } from "../../../src/persistence/database-port.js";
import { applyMigrations } from "../../../src/persistence/pg/migrator.js";
import { createPgDatabase } from "../../../src/persistence/pg/pg-database.js";
import { PgProviderLedger } from "../../../src/runtime/provider/pg-provider-ledger.js";
import { ProviderErrorCode } from "../../../src/runtime/provider/errors.js";
import { DEFAULT_PROVIDER_IDENTITY } from "../../../src/runtime/provider/identity.js";
import {
  buildProviderFailureRecord,
  buildProviderSuccessRecord,
  buildProviderUsageRecord,
  type ProviderCallMetadata,
  type ProviderExecutionRecord,
} from "../../../src/runtime/provider/records.js";
import {
  OpenAICompatibleProviderAdapter,
  type FetchLike,
} from "../../../src/runtime/provider/openai-compatible-adapter.js";
import {
  PROVIDER_ARTICLE_CONTENT_V1,
  type ProviderGenerateArticleContentRequest,
} from "../../../src/runtime/provider/provider-port.js";

const testConfig = loadDatabaseConfig({ test: true });
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

let db: DatabasePort;

interface Tenant {
  readonly orgId: string;
  readonly projectId: string;
  readonly userId: string;
}

async function createUser(email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO "user" (email) VALUES ($1) RETURNING id`,
    [email],
  );
  const row = res.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

async function createClientOrg(idempotencyKey: string, userId: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    [idempotencyKey, idempotencyKey, userId],
  );
  const row = res.rows[0];
  if (!row) throw new Error("organization insert returned no row");
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

async function bootstrapTenant(key: string): Promise<Tenant> {
  const userId = await createUser(`${key}@example.test`);
  const orgId = await createClientOrg(`client-${key}`, userId);
  const projectId = await createProject(orgId, userId, `Project ${key}`);
  return { orgId, projectId, userId };
}

/** Non-secret call metadata for a real project. articleBriefId is an opaque uuid. */
function metaFor(
  t: Tenant,
  overrides: Partial<Omit<ProviderCallMetadata, "projectId">> = {},
): ProviderCallMetadata {
  return {
    requestId: overrides.requestId ?? `req_${randomUUID()}`,
    idempotencyKey: overrides.idempotencyKey ?? `idem_${randomUUID()}`,
    projectId: t.projectId,
    articleBriefId: overrides.articleBriefId ?? randomUUID(),
    model: overrides.model ?? "deepseek-chat",
    identity: overrides.identity ?? DEFAULT_PROVIDER_IDENTITY,
    latencyMs: overrides.latencyMs ?? 42,
  };
}

function successRecord(t: Tenant, overrides?: Parameters<typeof metaFor>[1]): ProviderExecutionRecord {
  const meta = metaFor(t, overrides);
  const usage = buildProviderUsageRecord(meta, { promptTokens: 120, completionTokens: 340 });
  return buildProviderSuccessRecord(meta, usage);
}

function failureRecord(
  t: Tenant,
  code: ProviderErrorCode,
  overrides?: Parameters<typeof metaFor>[1],
): ProviderExecutionRecord {
  return buildProviderFailureRecord(metaFor(t, overrides), code);
}

describe.skipIf(testConfig === null)(
  "PROVIDER_EXECUTION_LEDGER_V1 — real database persistence",
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
        `TRUNCATE provider_execution, project, organization, "user" RESTART IDENTITY CASCADE`,
      );
    });

    it("applies 0007 and the provider_execution table stores NO key/prompt/response columns", async () => {
      const res = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'provider_execution'`,
      );
      const columns = res.rows.map((r) => r.column_name).sort();

      // Exact, whitelisted column set — anything extra (a leaked secret/content
      // column) would break this equality.
      expect(columns).toEqual(
        [
          "article_brief_id",
          "client_organization_id",
          "completion_tokens",
          "created_at",
          "error_code",
          "gateway_vendor",
          "id",
          "idempotency_key",
          "latency_ms",
          "model",
          "model_vendor",
          "project_id",
          "prompt_tokens",
          "protocol",
          "request_id",
          "status",
          "total_tokens",
        ].sort(),
      );

      // Defense in depth: none of these exact secret/raw-content column names exist.
      const forbidden = new Set([
        "api_key",
        "apikey",
        "authorization",
        "bearer",
        "secret",
        "password",
        "prompt",
        "prompt_text",
        "response",
        "response_text",
        "response_body",
        "content",
        "body",
        "completion",
        "completion_text",
        "message",
        "messages",
        "raw_prompt",
        "raw_response",
        // PROVIDER_IDENTITY_LEDGER_V1: identity is closed enums only — never an
        // endpoint, base URL, host, or workspace identifier.
        "base_url",
        "baseurl",
        "url",
        "endpoint",
        "endpoint_host",
        "host",
        "api_base",
        "workspace",
        "workspace_id",
      ]);
      for (const column of columns) {
        expect(forbidden.has(column)).toBe(false);
      }
    });

    it("persists a successful execution as one OK row with token counts", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);
      const record = successRecord(t);

      await ledger.recordExecution(record);

      const entry = await ledger.getByIdempotencyKey(record.idempotencyKey);
      expect(entry).not.toBeNull();
      expect(entry?.status).toBe("OK");
      expect(entry?.errorCode).toBeNull();
      expect(entry?.projectId).toBe(t.projectId);
      // client_organization_id is derived authoritatively from the project.
      expect(entry?.clientOrganizationId).toBe(t.orgId);
      expect(entry?.articleBriefId).toBe(record.articleBriefId);
      expect(entry?.model).toBe("deepseek-chat");
      // The canonical identity persisted verbatim (declared config, ALIYUN_MAAS
      // gateway / DEEPSEEK model / OPENAI_COMPATIBLE protocol for the runtime).
      expect(entry?.identity).toEqual(DEFAULT_PROVIDER_IDENTITY);
      expect(entry?.identity.gatewayVendor).toBe("ALIYUN_MAAS");
      expect(entry?.identity.modelVendor).toBe("DEEPSEEK");
      expect(entry?.identity.protocol).toBe("OPENAI_COMPATIBLE");
      expect(entry?.promptTokens).toBe(120);
      expect(entry?.completionTokens).toBe(340);
      expect(entry?.totalTokens).toBe(460);
      expect(entry?.latencyMs).toBe(42);

      expect(await ledger.countByIdempotencyKey(record.idempotencyKey)).toBe(1);
    });

    it("persists a failed execution as one ERROR row with an error_code and no tokens", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);
      const record = failureRecord(t, ProviderErrorCode.PROVIDER_TIMEOUT);

      await ledger.recordExecution(record);

      const entry = await ledger.getByIdempotencyKey(record.idempotencyKey);
      expect(entry?.status).toBe("ERROR");
      expect(entry?.errorCode).toBe(ProviderErrorCode.PROVIDER_TIMEOUT);
      expect(entry?.promptTokens).toBeNull();
      expect(entry?.completionTokens).toBeNull();
      expect(entry?.totalTokens).toBeNull();
      expect(entry?.clientOrganizationId).toBe(t.orgId);
      // Failure rows carry the identity exactly like success rows.
      expect(entry?.identity).toEqual(DEFAULT_PROVIDER_IDENTITY);
    });

    it("persists a non-default declared identity verbatim (e.g. a DeepSeek-direct call)", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);
      const record = successRecord(t, {
        identity: {
          gatewayVendor: "DEEPSEEK_DIRECT",
          modelVendor: "DEEPSEEK",
          protocol: "OPENAI_COMPATIBLE",
        },
      });

      await ledger.recordExecution(record);

      const entry = await ledger.getByIdempotencyKey(record.idempotencyKey);
      expect(entry?.identity).toEqual({
        gatewayVendor: "DEEPSEEK_DIRECT",
        modelVendor: "DEEPSEEK",
        protocol: "OPENAI_COMPATIBLE",
      });
    });

    it("rejects off-enum identity values via the 0008 CHECK constraints", async () => {
      const t = await bootstrapTenant("a");

      const insert = (gateway: string, modelVendor: string, protocol: string) =>
        db.query(
          `INSERT INTO provider_execution
             (request_id, idempotency_key, project_id, client_organization_id, article_brief_id,
              model, gateway_vendor, model_vendor, protocol,
              status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OK', NULL, 1, 2, 3, 10)`,
          [
            `req_${randomUUID()}`,
            `idem_${randomUUID()}`,
            t.projectId,
            t.orgId,
            randomUUID(),
            "deepseek-chat",
            gateway,
            modelVendor,
            protocol,
          ],
        );

      await expect(insert("EVIL_GATEWAY", "DEEPSEEK", "OPENAI_COMPATIBLE")).rejects.toThrow(
        /ck_provider_execution_gateway_vendor/,
      );
      await expect(insert("ALIYUN_MAAS", "EVIL_VENDOR", "OPENAI_COMPATIBLE")).rejects.toThrow(
        /ck_provider_execution_model_vendor/,
      );
      await expect(insert("ALIYUN_MAAS", "DEEPSEEK", "GRPC")).rejects.toThrow(
        /ck_provider_execution_protocol/,
      );
    });

    it("requires the identity to be declared on INSERT (the 0008 backfill DEFAULTs are dropped)", async () => {
      const t = await bootstrapTenant("a");

      // A pre-0008-shaped INSERT (no identity columns) must fail NOT NULL — a
      // writer can never silently mint a legacy-looking row after the backfill.
      await expect(
        db.query(
          `INSERT INTO provider_execution
             (request_id, idempotency_key, project_id, client_organization_id, article_brief_id,
              model, status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms)
           VALUES ($1, $2, $3, $4, $5, 'deepseek-chat', 'OK', NULL, 1, 2, 3, 10)`,
          [`req_${randomUUID()}`, `idem_${randomUUID()}`, t.projectId, t.orgId, randomUUID()],
        ),
      ).rejects.toThrow(/gateway_vendor|not-null|null value/i);
    });

    it("dedupes on idempotency key: same key -> exactly one row (first write wins)", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);
      const key = `idem_${randomUUID()}`;

      const first = successRecord(t, { idempotencyKey: key });
      await ledger.recordExecution(first);
      // Re-emit the identical record (a duplicated observer emission / retry).
      await ledger.recordExecution(first);
      // A DIFFERENT outcome under the SAME key must not create a second row.
      const conflicting = failureRecord(t, ProviderErrorCode.PROVIDER_RATE_LIMIT, {
        idempotencyKey: key,
      });
      await ledger.recordExecution(conflicting);

      expect(await ledger.countByIdempotencyKey(key)).toBe(1);
      // The original OK row is preserved; the later ERROR write was a no-op.
      const entry = await ledger.getByIdempotencyKey(key);
      expect(entry?.status).toBe("OK");
      expect(entry?.errorCode).toBeNull();
    });

    it("is append-only: UPDATE and DELETE against provider_execution are rejected", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);
      const record = successRecord(t);
      await ledger.recordExecution(record);

      await expect(
        db.query(`UPDATE provider_execution SET model = 'tampered' WHERE idempotency_key = $1`, [
          record.idempotencyKey,
        ]),
      ).rejects.toThrow(/append-only/i);
      // The 0008 identity columns are equally immutable — history can never be
      // relabeled to a different gateway/vendor/protocol after the fact.
      await expect(
        db.query(
          `UPDATE provider_execution SET gateway_vendor = 'DEEPSEEK_DIRECT' WHERE idempotency_key = $1`,
          [record.idempotencyKey],
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(
          `UPDATE provider_execution SET model_vendor = 'OTHER', protocol = 'OPENAI_COMPATIBLE' WHERE idempotency_key = $1`,
          [record.idempotencyKey],
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM provider_execution WHERE idempotency_key = $1`, [
          record.idempotencyKey,
        ]),
      ).rejects.toThrow(/append-only/i);

      // The row is untouched.
      expect((await ledger.getByIdempotencyKey(record.idempotencyKey))?.model).toBe("deepseek-chat");
    });

    it("rejects an execution whose project does not exist (no silent drop)", async () => {
      const ledger = new PgProviderLedger(db);
      const orphan: ProviderExecutionRecord = {
        requestId: `req_${randomUUID()}`,
        idempotencyKey: `idem_${randomUUID()}`,
        projectId: randomUUID(), // no such project row
        articleBriefId: randomUUID(),
        model: "deepseek-chat",
        identity: DEFAULT_PROVIDER_IDENTITY,
        outcome: "OK",
        latencyMs: 10,
        usage: {
          requestId: "x",
          idempotencyKey: "x",
          model: "deepseek-chat",
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          latencyMs: 10,
        },
        errorCode: null,
      };
      await expect(ledger.recordExecution(orphan)).rejects.toThrow(/does not exist/i);
      expect(await ledger.countByIdempotencyKey(orphan.idempotencyKey)).toBe(0);
    });

    it("isolates tenants: client A's executions are invisible to client B", async () => {
      const a = await bootstrapTenant("a");
      const b = await bootstrapTenant("b");
      const ledger = new PgProviderLedger(db);

      await ledger.recordExecution(successRecord(a));
      await ledger.recordExecution(failureRecord(a, ProviderErrorCode.PROVIDER_UNAVAILABLE));
      await ledger.recordExecution(successRecord(b));

      const scopedA = await ledger.listByScope({
        clientOrganizationId: a.orgId,
        projectId: a.projectId,
      });
      const scopedB = await ledger.listByScope({
        clientOrganizationId: b.orgId,
        projectId: b.projectId,
      });

      expect(scopedA).toHaveLength(2);
      expect(scopedA.every((e) => e.clientOrganizationId === a.orgId)).toBe(true);
      expect(scopedB).toHaveLength(1);
      expect(scopedB.every((e) => e.clientOrganizationId === b.orgId)).toBe(true);

      // A mismatched org+project scope (B's org, A's project) sees nothing.
      const crossed = await ledger.listByScope({
        clientOrganizationId: b.orgId,
        projectId: a.projectId,
      });
      expect(crossed).toEqual([]);
    });

    it("captures a real D2 adapter execution via asObserver() with a fake fetch (no network, no key leak)", async () => {
      const t = await bootstrapTenant("a");
      const ledger = new PgProviderLedger(db);

      const SECRET_KEY = "sk-LEDGER-LEAK-CANARY-do-not-store";
      const goodEnvelope = {
        id: "chatcmpl-test",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                schemaVersion: PROVIDER_ARTICLE_CONTENT_V1,
                title: "How ACME cut deploy time in half",
                summary: "A concise, governance-free summary.",
                sections: [{ heading: "Background", body: "The first body paragraph." }],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
      };

      const fetchCalls: string[] = [];
      const fakeFetch: FetchLike = async (input) => {
        fetchCalls.push(typeof input === "string" ? input : input.toString());
        return new Response(JSON.stringify(goodEnvelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      // Guard: the real global fetch must never be reached.
      const globalFetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("no real network call is permitted in this test"));

      const briefId = randomUUID();
      const request: ProviderGenerateArticleContentRequest = {
        projectId: t.projectId,
        articleBriefId: briefId,
        model: "deepseek-chat",
        maxTokens: 1024,
        timeoutMs: 30_000,
        requestId: `req_${randomUUID()}`,
        idempotencyKey: `idem_${randomUUID()}`,
      };

      try {
        const adapter = new OpenAICompatibleProviderAdapter({
          fetch: fakeFetch,
          env: {
            PROVIDER_RUNTIME_ENABLED: "true",
            PROVIDER_API_KEY: SECRET_KEY,
            PROVIDER_BASE_URL: "https://api.deepseek.test",
            PROVIDER_MODEL: "deepseek-chat",
          },
          observer: ledger.asObserver(),
        });

        const result = await adapter.generateArticleContent(request);
        expect(result.ok).toBe(true);

        // Let the out-of-band ledger writes settle.
        await ledger.drain();

        expect(fetchCalls).toHaveLength(1);
        expect(globalFetchSpy).not.toHaveBeenCalled();

        const entry = await ledger.getByIdempotencyKey(request.idempotencyKey);
        expect(entry).not.toBeNull();
        expect(entry?.status).toBe("OK");
        expect(entry?.projectId).toBe(t.projectId);
        expect(entry?.clientOrganizationId).toBe(t.orgId);
        expect(entry?.articleBriefId).toBe(briefId);
        expect(entry?.promptTokens).toBe(11);
        expect(entry?.completionTokens).toBe(22);
        expect(entry?.totalTokens).toBe(33);
        // The adapter's declared identity (its config default) landed on the row.
        expect(entry?.identity).toEqual(DEFAULT_PROVIDER_IDENTITY);

        // The API key never reached the persisted row.
        expect(JSON.stringify(entry)).not.toContain(SECRET_KEY);
      } finally {
        globalFetchSpy.mockRestore();
      }
    });
  },
);
