/**
 * SANITIZED_PROVIDER_MICRO_CANARY_V1 — the ONE controlled real-model call.
 *
 * SKIPPED unless RUN_PROVIDER_CANARY==="true" (set only by scripts/provider/micro-canary.mjs), so
 * `npm test` never makes a real network call. When triggered it makes AT MOST ONE real HTTP request
 * (a fetch guard rejects a 2nd without touching the network), through the real
 * OpenAICompatibleProviderAdapter + PgProviderLedger, against the ISOLATED CANARY database
 * (GEO_CANARY_DATABASE_URL ONLY — never the runtime or automated-test database, no fallback;
 * ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1), using a fully desensitized org/project and NO
 * customer data. It creates no approval/publish/receipt.
 * A sanitized summary (no key / no prompt / no response) is written for the report.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDatabaseConfig, loadDatabaseConfigForRole } from "../../src/persistence/config.js";
import type { DatabasePort } from "../../src/persistence/database-port.js";
import { createPgDatabase } from "../../src/persistence/pg/pg-database.js";
import { applyMigrations } from "../../src/persistence/pg/migrator.js";
import { validateProviderContent } from "../../src/runtime/provider/contract-validation.js";
import { OpenAICompatibleProviderAdapter } from "../../src/runtime/provider/openai-compatible-adapter.js";
import { PgProviderLedger } from "../../src/runtime/provider/pg-provider-ledger.js";

const RUN = process.env.RUN_PROVIDER_CANARY === "true";
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
export const CANARY_SUMMARY_PATH = join(tmpdir(), "geo-provider-micro-canary-summary.json");

// The canary reads ONLY the dedicated canary database role — never GEO_TEST_DATABASE_URL or
// GEO_DATABASE_URL (no fallback, no override).
const canaryConfig = loadDatabaseConfigForRole("canary");
let db: DatabasePort;

async function seedProject(): Promise<{ projectId: string; clientOrgId: string }> {
  const u = await db.query<{ id: string }>(`INSERT INTO "user" (email) VALUES ($1) RETURNING id`, [
    `canary+${randomUUID()}@example.test`,
  ]);
  const userId = u.rows[0]!.id;
  const org = await db.query<{ id: string }>(
    `INSERT INTO organization (type, display_name, idempotency_key, created_by_user_id)
     VALUES ('CLIENT', $1, $2, $3) RETURNING id`,
    ["示例健康管理机构（脱敏）", `canary-org-${randomUUID()}`, userId],
  );
  const clientOrgId = org.rows[0]!.id;
  const proj = await db.query<{ id: string }>(
    `INSERT INTO project (client_organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [clientOrgId, "脱敏 GEO 内容试点", userId],
  );
  return { projectId: proj.rows[0]!.id, clientOrgId };
}

async function ledgerCount(): Promise<number> {
  const r = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM provider_execution`);
  return Number(r.rows[0]?.n ?? "0");
}

describe.skipIf(!RUN || canaryConfig === null)("SANITIZED_PROVIDER_MICRO_CANARY_V1", () => {
  beforeAll(async () => {
    const conn = canaryConfig!.connectionString;
    // Hard safety: only the dedicated, clearly-labelled canary database — never the runtime
    // database, and never the automated-test database (compared by host+port+dbname).
    if (/\/geoplane_runtime(\?|$)/.test(conn)) {
      throw new Error("micro-canary refuses to run against the production runtime database");
    }
    const dbNameOf = (raw: string): string => {
      try {
        return new URL(raw).pathname.replace(/^\//, "");
      } catch {
        return "";
      }
    };
    if (!/canary/i.test(dbNameOf(conn))) {
      throw new Error("micro-canary requires GEO_CANARY_DATABASE_URL to name a clearly-labelled canary database");
    }
    const targetOf = (raw: string): string | null => {
      try {
        const u = new URL(raw);
        return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
      } catch {
        return null;
      }
    };
    for (const other of [loadDatabaseConfig(), loadDatabaseConfig({ test: true })]) {
      if (other && targetOf(other.connectionString) === targetOf(conn)) {
        throw new Error("micro-canary refuses a canary database that coincides with the runtime/test database");
      }
    }
    db = createPgDatabase({ connectionString: conn, max: 2 });
    await applyMigrations(db, migrationsDir);
  });
  afterAll(async () => {
    if (db) await db.close();
  });

  it("makes exactly ONE real provider call, records one clean ledger row, creates no approval/publish", async () => {
    const { projectId } = await seedProject();
    const ledger = new PgProviderLedger(db);

    // Fetch guard: the FIRST call reaches the network; a SECOND is rejected WITHOUT any network I/O.
    let networkCallCount = 0;
    const guardedFetch: typeof fetch = (...args) => {
      networkCallCount += 1;
      if (networkCallCount > 1) {
        return Promise.reject(new Error("micro-canary: refusing a second real network call"));
      }
      return globalThis.fetch(...(args as Parameters<typeof fetch>));
    };

    const adapter = new OpenAICompatibleProviderAdapter({
      env: process.env,
      allowedModels: ["deepseek-v4-flash"],
      maxTokensCeiling: 1200,
      timeoutMsCeiling: 60000,
      fetch: guardedFetch,
      observer: ledger.asObserver(),
    });

    const request = {
      projectId,
      articleBriefId: randomUUID(),
      model: "deepseek-v4-flash",
      maxTokens: 1200,
      timeoutMs: 60000,
      requestId: randomUUID(),
      idempotencyKey: `canary-${randomUUID()}`,
    };

    const before = await ledgerCount();
    const result = await adapter.generateArticleContent(request);
    await ledger.drain();
    const after = await ledgerCount();

    // Exactly one real network call and exactly one new ledger row (OK or error — both durable).
    expect(networkCallCount).toBe(1);
    expect(after - before).toBe(1);

    // The persisted ledger row: correct model + correlation ids, no secret/raw-content columns.
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_execution'`,
    );
    const colNames = cols.rows.map((r) => r.column_name.toLowerCase());
    const forbidden = colNames.filter((c) =>
      ["api_key", "apikey", "secret", "token", "access_token", "prompt", "response", "content", "prompt_text", "response_text", "raw_content", "content_text"].includes(c),
    );
    expect(forbidden).toEqual([]);

    const row = await db.query<{
      id: string;
      request_id: string;
      idempotency_key: string;
      model: string;
      status: string;
      error_code: string | null;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      latency_ms: number | null;
    }>(`SELECT * FROM provider_execution WHERE idempotency_key = $1`, [request.idempotencyKey]);
    expect(row.rows).toHaveLength(1);
    const r = row.rows[0]!;
    expect(r.model).toBe("deepseek-v4-flash");
    expect(r.request_id).toBe(request.requestId);
    expect(r.latency_ms).not.toBeNull();

    let governanceLeakCount = 0;
    let contractValidation: "PASS" | "N/A" = "N/A";
    if (result.ok) {
      // Governance firewall: the model's content must validate + carry no governance fields.
      const validated = validateProviderContent(result.content);
      expect(validated.ok).toBe(true);
      contractValidation = "PASS";
      const serialized = JSON.stringify(result.content).toLowerCase();
      for (const term of ["gate", "approval", "publication", "evidence_hash", "channel", "lifecycle"]) {
        if (serialized.includes(`"${term}"`)) governanceLeakCount += 1;
      }
      expect(governanceLeakCount).toBe(0);
      expect(r.status).toBe("OK");
      expect(r.total_tokens).not.toBeNull();
    } else {
      // A failure still recorded a clean row with a taxonomy error code and NO tokens.
      expect(r.status).toBe("ERROR");
      expect(r.error_code).not.toBeNull();
    }

    // Append-only: the ledger row cannot be updated or deleted.
    await expect(
      db.query(`UPDATE provider_execution SET model = 'x' WHERE id = $1`, [r.id]),
    ).rejects.toThrow();
    await expect(
      db.query(`DELETE FROM provider_execution WHERE id = $1`, [r.id]),
    ).rejects.toThrow();

    // No approval / publish-package / distribution-plan / publication-receipt were created here.
    const approvals = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM article_approval`);
    const receipts = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM publication_receipt`);
    expect(Number(approvals.rows[0]!.n)).toBe(0);
    expect(Number(receipts.rows[0]!.n)).toBe(0);

    // Sanitized summary for the report — NO key, NO prompt, NO response body.
    writeFileSync(
      CANARY_SUMMARY_PATH,
      JSON.stringify(
        {
          model: r.model,
          providerResult: result.ok ? "PASS" : "FAIL",
          providerErrorCode: r.error_code,
          contractValidation,
          governanceLeakCount,
          realNetworkCalls: networkCallCount,
          promptTokens: r.prompt_tokens,
          completionTokens: r.completion_tokens,
          totalTokens: r.total_tokens,
          latencyMs: r.latency_ms,
          ledgerRowsAdded: after - before,
          ledgerRowId: r.id,
          ledgerAppendOnly: "PASS",
          articleApprovalCreated: false,
          publicationReceiptCreated: false,
        },
        null,
        2,
      ),
      "utf8",
    );
  }, 90_000);
});
