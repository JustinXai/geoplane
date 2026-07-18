/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (persistence boundary),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation, append-only history),
 *   migrations/0001_tenancy_foundation.sql (the real schema this port talks to).
 * reconstruction_reason: CORE_RUNTIME_COMPLETION_V1 / POSTGRES_RUNTIME_V1 - the overnight
 *   rebuild proved the contracts in-memory only; this is the first real persistence seam.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * The application depends on THIS interface, never on `pg` directly, so that:
 *   - repositories are unit-testable against any Queryable,
 *   - a transaction is a first-class boundary (TransactionPort), and
 *   - the concrete driver (node-postgres) is swappable and confined to ./pg.
 */

/** SQL bind-parameter value types this runtime uses. Intentionally narrow. */
export type SqlParam = string | number | boolean | null | Date;

export interface DbQueryResult<T> {
  readonly rows: T[];
  /** Rows affected/returned; 0 when the driver reports null. */
  readonly rowCount: number;
}

/** The minimal query surface shared by the pool-level port and a live transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly SqlParam[],
  ): Promise<DbQueryResult<T>>;
}

/** A handle valid only for the duration of a single DatabasePort.transaction() callback. */
export type TransactionPort = Queryable;

export interface DatabasePort extends Queryable {
  /**
   * Runs `work` inside a single BEGIN/COMMIT. Any throw rolls the whole unit back.
   * Repositories that must be atomic together take the TransactionPort, not the pool.
   */
  transaction<T>(work: (tx: TransactionPort) => Promise<T>): Promise<T>;
  /** Releases all pooled connections. Call once at process/test-suite shutdown. */
  close(): Promise<void>;
}
