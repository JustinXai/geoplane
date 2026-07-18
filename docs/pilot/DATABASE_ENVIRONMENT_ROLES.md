# DATABASE_ENVIRONMENT_ROLES — the three database environment roles

Checkpoint: `ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1` (Agent C, `ops/environment-reconciliation-v1`).

The geoplane runtime uses exactly THREE database environment roles. Each role is carried by its own
env var (resolved from `process.env` first, then the gitignored `.env.local` — see
`src/persistence/config.ts`, `DatabaseEnvironmentRole` / `loadDatabaseConfigForRole`).

| Role | Env var | Purpose | Naming rule |
| --- | --- | --- | --- |
| runtime | `GEO_DATABASE_URL` | Local/staging runtime database. Real application data. | Name must NOT look like a test/canary DB. |
| test | `GEO_TEST_DATABASE_URL` | Automated-test database. DB-backed tests **TRUNCATE it freely** — it must always be throwaway. | Name must contain `test`. |
| canary | `GEO_CANARY_DATABASE_URL` | Isolated database dedicated to provider canary runs (`scripts/provider/micro-canary.mjs`). | Name must contain `canary`, and its target (host+port+dbname) must differ from BOTH the runtime and test databases. |

## Hard rules

1. **The canary never points at the runtime or test database.** Target identity is compared by
   host + port + dbname. Enforced in three places: the canary runner
   (`scripts/provider/micro-canary.mjs`), the canary test's `beforeAll` guard
   (`tests/pilot/provider-micro-canary.canary.test.ts`), and `DatabaseEnvironmentPreflightV1`.
2. **The canary runner reads ONLY `GEO_CANARY_DATABASE_URL`.** There is no fallback to (and no
   temporary override of) `GEO_TEST_DATABASE_URL` or `GEO_DATABASE_URL`. The pre-reconciliation
   pattern of overriding `GEO_TEST_DATABASE_URL` for a canary run is eliminated — a missing
   canary URL aborts the runner.
3. **Tests only ever TRUNCATE the test role's database.** The runtime database is never a valid
   test/canary target.
4. Credentials live ONLY in the gitignored `.env.local` (template: `.env.example`, placeholders
   only). No URL with a real credential is ever committed, printed, or logged.

## DatabaseEnvironmentPreflightV1

Verifies all three roles. Run it with:

```
npm run preflight:db-env       # node scripts/preflight/database-environment.mjs
```

Checks per role: URL present → db name matches the role's purpose (and canary/runtime/test target
distinctness) → connectable → connected role privileges appropriate (no superuser; the test role
can TRUNCATE application tables) → `schema_migrations` ledger consistent with
`migrations/manifest.json` (FLOOR semantics; the expected latest version is **derived from the
manifest**, never hardcoded, so it follows future migrations such as 0008 automatically).

Closed error taxonomy (every failure maps to exactly one code):

| Code | Meaning |
| --- | --- |
| `DATABASE_URL_MISSING` | The role's env var is unset/empty. |
| `DATABASE_AUTH_FAILED` | The server rejected the configured credential. |
| `DATABASE_ROLE_INVALID` | Connected, but the role's privileges are inappropriate (superuser, cannot connect to the database, or test role cannot TRUNCATE). |
| `DATABASE_PURPOSE_MISMATCH` | The URL points at a database that does not match the role's purpose (naming/target rules above). |
| `DATABASE_UNREACHABLE` | No server answered (refused/timeout/DNS/missing database/bad URL). |
| `DATABASE_MIGRATION_BEHIND` | `schema_migrations` is missing a version required by the manifest (or does not exist). |

Implementation: `src/runtime/observability/database-environment-preflight.ts` (pure, injectable,
unit-tested offline) mirrored by the CLI `scripts/preflight/database-environment.mjs` (same
`.ts`/`.mjs` split as the deployment preflight — keep both in sync). Tests:
`tests/runtime/staging/database-environment-preflight.test.ts` (offline taxonomy) and
`tests/runtime/staging/database-environment-preflight.pg.test.ts` (live pass against the three
configured roles).

## Local reconciliation record (2026-07-18, secret-free)

- Symptom: `GEO_TEST_DATABASE_URL` (and `GEO_DATABASE_URL`) in the operator's `.env.local` failed
  authentication (SQLSTATE 28P01) as `geoplane_app`; an earlier canary run had worked around it by
  overriding `GEO_TEST_DATABASE_URL` to another database. That override pattern is now removed.
- Diagnosis: the credential recorded in the operator's `.env.local` had drifted from the live
  `geoplane_app` role credential (the per-worktree env files still carried the working one). No
  server-side role/permission problem existed.
- Fix: `.env.local` was updated (uncommitted; backup written alongside it) so all three URLs use
  the working `geoplane_app` credential, and `GEO_CANARY_DATABASE_URL` was added pointing at the
  pre-existing dedicated `geoplane_canary` database. Databases: runtime=`geoplane_runtime`,
  test=`geoplane_runtime_test`, canary=`geoplane_canary` — all owned by the non-superuser
  application role `geoplane_app`, all migrated to the manifest floor.
- Note for other worktrees: `rc-integration`, `rc-pilotops` and `rc-provid` `.env.local` copies
  carry the same stale credential and will fail `DATABASE_AUTH_FAILED` until refreshed the same way.
