/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — small shared helpers for the article/gate/
 * delivery Postgres adapters (migrations/0004_geo_article_delivery.sql).
 *
 * `isUniqueViolation` translates a duplicate-primary-key error into the same
 * append-only rejection the in-memory fakes produce. `ParamList` builds a
 * parameterized INSERT incrementally — including Postgres array columns via
 * `ARRAY[$n, ...]::cast` — so every bound value stays a scalar `SqlParam`
 * (arrays are never passed as a single bind value, which the narrow SqlParam
 * type deliberately forbids).
 */
import type { SqlParam } from "../../../persistence/database-port.js";

/** Postgres unique_violation. A duplicate primary key surfaces here on `add`. */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Accumulates bind parameters and hands back the `$n` placeholder for each, so
 * an INSERT's column list and VALUES stay in lock-step without hand-counting
 * indices. `array()` emits a parameterized `ARRAY[...]::cast` (or `'{}'::cast`
 * for an empty list) — every element is a separate scalar bind, so nothing
 * violates the narrow `SqlParam` type.
 */
export class ParamList {
  readonly values: SqlParam[] = [];

  /** Bind one scalar value; returns its `$n` placeholder. */
  add(value: SqlParam): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** Bind a string list as a Postgres array literal of the given cast (e.g. "text[]", "uuid[]"). */
  array(list: readonly string[], cast: string): string {
    if (list.length === 0) return `'{}'::${cast}`;
    const placeholders = list.map((value) => this.add(value));
    return `ARRAY[${placeholders.join(", ")}]::${cast}`;
  }
}
