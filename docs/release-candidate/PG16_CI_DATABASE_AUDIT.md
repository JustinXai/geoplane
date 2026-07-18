# PG16_CI_DATABASE_AUDIT — PG16_CI_SUPERVISOR_AUDIT_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` · Supervisor branch: `audit/pg16-ci-supervisor-v1`
- Audited tree: `cf6617d7955bbfd6bd3e8c1bd71fecf983072482` == head_sha of green run 29654550660.
- Scope: checklist items 1, 2, 6, 7, 8, 9.
- Method: static read of workflow + scripts + migrations; unauthenticated GitHub REST verification of
  the public run. No DB was touched by this audit.

## Item 1 — CI really uses PostgreSQL 16: **PASS** (one minor gap noted)

- `scripts/ci/postgres16-verify.mjs:46` executes `SELECT version() …, current_setting('server_version')`
  against `GEO_DATABASE_URL`; `:61-77` parses the **major from the server's own answer** and exits 1
  unless it is in `allowedMajors`, which is strictly `{16}` when `--allow-major` is absent (`:24`).
- The workflow invokes it with **no flags** — `.github/workflows/closed-pilot-postgres16.yml:135-136` —
  i.e. strict canonical 16; and it runs **before** the gates (`Verify server is PostgreSQL 16.x` at
  lines 135–136 precedes `Run database gates` at 138–139).
- The service container is pinned `image: postgres:16` in both DB jobs (lines 83, 158), but the image
  name is never used as version evidence — the SQL assertion is.
- Run 29654550660 job `postgres16-gates` concluded **success** (job 88106530533), so the strict verify
  exited 0 ⇒ the server that the gates then ran against answered major 16 via `SELECT version()`.
- The reported evidence value `postgresVersion = "PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1)…"` comes
  from job 2's own `SELECT version()` capture (`run-database-gates.mjs:339`), consistent with the
  postgres:16 image at run date; the exact minor could not be re-read without credentials (artifact
  download requires auth) and carries no gate weight.
- **MINOR GAP (recommendation, not a violation):** job 3 (`backup-restore-gates`) has its own fresh
  `postgres:16` service container but does **not** re-run `postgres16-verify.mjs`; its server version is
  attested by the image pin plus the client-tool assertions (`pg_dump`/`pg_restore` must match
  `(PostgreSQL) 16\.` — lines 199–204). By the repo's own reporting rule ("image name is not version
  evidence") job 3's *server* is one SQL assertion short. Recommend adding the verify step to job 3.

## Item 2 — CI connects to NO external database: **PASS**

- Every database URL in the workflow is `postgresql://…@localhost:5432/…` — all 12 occurrences (lines
  100, 105–107, 173, 177–179, 230–232), plus `pg_isready -h localhost` (lines 124, 209). grep over the
  workflow finds **no other host** in any connection string.
- The postgres services are **job-scoped containers** (`services:` blocks, lines 81–94 and 156–169)
  published on the runner's localhost and destroyed when the job ends.
- `scripts/ci/*` open connections only to URLs derived from these env vars
  (`resolveCiTopology`/`urlFor`, `create-isolated-databases.mjs:136-186`) and contain no HTTP/socket
  code (grep: no `fetch(`, no `https://`, no `net.`).
- Remaining network egress (actions marketplace, `npm ci`, `apt-get`) is package tooling, not database
  traffic, and carries no repo credential.

## Item 6 — runtime/test/canary CI DBs distinct and purpose-checked: **PASS**

- Provisioning guards (`scripts/ci/create-isolated-databases.mjs`):
  - `:107-129` `validateCiDbName` — test name **must contain** `test`, canary **must contain** `canary`,
    runtime must contain **neither**;
  - `:144-151` the three names must be **distinct** (Set size 3 or `CI_DB_GATE_PURPOSE_MISMATCH`);
  - `:152-157` a CI DB name colliding with the admin maintenance DB is refused — exactly the guard that
    (correctly) failed run 1;
  - `:159-166` the owner role must be a **non-superuser** distinct from the admin role;
  - `:264-284` post-provision probe proves the app role can log in to each DB as itself.
- Runtime preflight: `run-database-gates.mjs:232-238` runs `DatabaseEnvironmentPreflightV1`
  (`scripts/preflight/database-environment.mjs`) with the app-role URLs; the preflight independently
  re-checks purpose naming (`:89-107`), refuses superuser connections (`:126`), requires test-role
  TRUNCATE capability (`:128-137`), and refuses a canary URL that targets the runtime or test database
  (`:96-105`). It ran green inside gate `purposePreflight` (PASS required for job success).
- In CI the names are the defaults `geoplane_ci_runtime` / `geoplane_ci_test` / `geoplane_ci_canary`
  (workflow lines 105–107) — distinct and purpose-conformant by construction.

## Item 7 — CI cannot truncate a runtime DB outside its own throwaway containers: **PASS** (residual note)

- Reachability: per item 2, every connection in CI terminates at the job's own localhost service
  container. There is no route to any external/staging/production server.
- Name guards re-asserted **at the point of destruction**: `create-isolated-databases.mjs:222-228`
  (`assertSafeDbIdentifier` + `assertNotProtectedDb` immediately before `DROP DATABASE … WITH (FORCE)`);
  `run-backup-restore-gate.mjs:205-208` guards both the throwaway restore target and the backup source.
- `PRODUCTION_DB_PATTERN` (`scripts/backup/pg-lib.mjs:131-132`) refuses `prod|production|prd|live|
  recovery|recover|recovered` as delimited tokens for any dump/restore/drop performed by these tools.
- **Residual note (documented design, not a violation):** the pattern deliberately does *not* protect
  the bare name `geoplane_runtime` (`pg-lib.mjs:127-130` states this explicitly) — for that name the
  effective CI protection is network isolation (localhost-only service containers) plus the fact that
  CI URLs are hardcoded in the workflow. The canary path carries its own independent refusal of
  `geoplane_runtime` (`tests/pilot/provider-micro-canary.canary.test.ts:64-66`).

## Item 8 — migrations 0001–0008 really ran; backup/restore really ran on PG16: **PASS**

- The migrations directory contains exactly `0001…0008` (8 files) + `manifest.json`; their
  `CREATE TABLE` statements total **42** (12+6+6+14+2+1+1+0) — independently matching the reported
  evidence `migrationCount 8` / `tableCount 42`.
- Job 2: `run-database-gates.mjs:195-221` runs `scripts/db/migrate.mjs` for runtime, `--test`, and
  `--canary`, then **independently queries `schema_migrations` in each DB** and records gate
  `migrations=FAIL` if any required version (derived from the manifest, never hardcoded) is absent.
  Gate PASS is mandatory for job success (`:501-506`), and job 88106530533 succeeded.
- Job 3 (fresh runner + fresh container): explicit migrate steps for all three CI DBs as the
  non-superuser app role (workflow lines 228–236); any non-zero exit fails the job.
- Backup/restore on PG16: job 3 (88106616182, success) ran `run-backup-restore-gate.mjs` end-to-end —
  real `backup.mjs` custom-format dump, **checksum re-hashed and compared** to the CLI's printed sha256
  (`:256-277`), real `restore.mjs` into a fresh uniquely-named guarded DB (`:279-300`), SQL read-back
  (`:302-368`), throwaway DB dropped (`:373-385`). Client tools asserted `pg_dump/pg_restore (PostgreSQL) 16.x`
  before use (workflow lines 199–204). Data was the seeded sanitized set (fresh job-3 DBs are empty, so
  `seedMinimalRows` ran — `:225-229`; evidence records `seeded: true` semantics honestly).
- The reported `constraintCount 294` / `triggerCount 24` come from job 2's live catalog queries
  (`run-database-gates.mjs:424-445`); they could not be re-read without credentials and carry no gate
  weight (the gates assert *behavior* — rejects/triggers — not these counts).

## Item 9 — provider ledger identity fields verified in CI: **PASS**

- Read-back includes identity: `run-backup-restore-gate.mjs:96-108` selects
  `gateway_vendor, model_vendor, protocol` (with `model`) from `provider_execution`; `:316-328` requires
  every source row to match its restored counterpart on **all four** fields and requires the set to be
  non-empty (`providerIdentityVerified` false on empty ⇒ FAIL).
- Append-only exercised post-restore: `:170-184` + `:336-341` — UPDATE and DELETE against
  `provider_execution` in the **restored** database must both be rejected with an `/append-only/i`
  error, or `readBack=FAIL`.
- Job 2 equivalents: gate `providerLedger` = the two dedicated pg suites
  (`run-database-gates.mjs:308-314`); spot-gate `appendOnly` (`:387-410`) requires UPDATE+DELETE
  rejection with the append-only trigger message on the populated CI test DB.
- Schema ground truth: `migrations/0008_provider_identity.sql:57-76` (columns + closed CHECK sets
  `ck_provider_execution_gateway_vendor/model_vendor/protocol`), `0007_provider_ledger.sql:152`
  (append-only trigger exception).

## Verdict (this document)

**PASS — 0 real violations.** One improvement recommendation (add `postgres16-verify.mjs` to job 3)
and one documented residual note (the `geoplane_runtime` name is outside `PRODUCTION_DB_PATTERN` by
design; CI safety for it rests on localhost-only isolation, which item 2 verifies).
