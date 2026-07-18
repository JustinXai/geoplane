/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: migrations/0001_tenancy_foundation.sql, src/persistence/database-port.ts
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - concrete
 *   node-postgres implementation of DatabasePort. This is the ONLY file allowed to import `pg`.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import { Pool } from "pg";
import type {
  DatabasePort,
  DbQueryResult,
  SqlParam,
  TransactionPort,
} from "../database-port.js";

export interface PgDatabaseConfig {
  readonly connectionString: string;
  /** Pool ceiling. Kept small for a dev/test runtime; enough to exercise real concurrency. */
  readonly max?: number;
}

function toParams(params?: readonly SqlParam[]): SqlParam[] | undefined {
  return params ? [...params] : undefined;
}

export function createPgDatabase(config: PgDatabaseConfig): DatabasePort {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
  });

  async function query<T = Record<string, unknown>>(
    text: string,
    params?: readonly SqlParam[],
  ): Promise<DbQueryResult<T>> {
    const res = await pool.query(text, toParams(params));
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  }

  async function transaction<T>(work: (tx: TransactionPort) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tx: TransactionPort = {
        async query<R = Record<string, unknown>>(text: string, params?: readonly SqlParam[]) {
          const res = await client.query(text, toParams(params));
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
      };
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return { query, transaction, close: () => pool.end() };
}
