/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — readiness evaluation + dependency wiring.
 *
 * Kept OUT of the App Router route module because a Next.js route file may only export the
 * framework's recognised names (GET, runtime, dynamic, ...); a test seam or helper exported from
 * the route breaks `next build`'s route-type check. So the DB singleton, the test seam, and the
 * check orchestration live here, and src/app/api/health/ready/route.ts is a thin adapter.
 *
 * The produced body carries only check names / statuses / secret-free detail strings — never a DB
 * URL, signing key, or any other secret.
 */
import { loadDatabaseConfig } from "../../persistence/config.js";
import type { DatabasePort } from "../../persistence/database-port.js";
import { createPgDatabase } from "../../persistence/pg/pg-database.js";
import {
  isProductionRun,
  readPreflightEnv,
  runPreflightChecks,
  summarize,
  type PreflightEnv,
} from "./preflight.js";

export interface ReadyDependencies {
  /** A live database handle, or null when no database URL is configured. */
  readonly db: DatabasePort | null;
  readonly env: PreflightEnv;
  readonly prod: boolean;
}

export interface ReadinessBodyCheck {
  readonly name: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly blocker: boolean;
  readonly detail: string;
}

export interface ReadinessResult {
  readonly httpStatus: number;
  readonly body: {
    readonly status: "ready" | "not_ready";
    readonly checks: readonly ReadinessBodyCheck[];
  };
}

let overrideDeps: ReadyDependencies | null = null;
let dbSingleton: DatabasePort | null = null;
let dbSingletonResolved = false;

/** Test seam: force readiness to use injected dependencies (or null to restore the default). */
export function __setReadyDependenciesForTests(deps: ReadyDependencies | null): void {
  overrideDeps = deps;
}

/** Lazily builds the process-wide DatabasePort from the runtime DB URL (null when unconfigured). */
function defaultDb(): DatabasePort | null {
  if (!dbSingletonResolved) {
    const config = loadDatabaseConfig();
    dbSingleton = config ? createPgDatabase(config) : null;
    dbSingletonResolved = true;
  }
  return dbSingleton;
}

export function resolveReadyDependencies(): ReadyDependencies {
  if (overrideDeps) return overrideDeps;
  return {
    db: defaultDb(),
    env: readPreflightEnv(),
    prod: isProductionRun(),
  };
}

/** Runs the readiness checks and maps them to an HTTP status + a secret-free body. */
export async function evaluateReadiness(): Promise<ReadinessResult> {
  const deps = resolveReadyDependencies();
  const checks = await runPreflightChecks({ env: deps.env, db: deps.db, prod: deps.prod });
  const report = summarize(checks);
  return {
    httpStatus: report.ok ? 200 : 503,
    body: {
      status: report.ok ? "ready" : "not_ready",
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        blocker: c.blocker,
        detail: c.detail,
      })),
    },
  };
}
