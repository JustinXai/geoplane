# Backup / Restore + Canonical Postgres Verification — STAGING_OPERATIONS_V1 batch 2 (Agent E2)

Operational notes for the pilot's database backup, restore-to-fresh, and canonical-PostgreSQL
verification. Owned by Agent E2; lives in a clearly-named file to avoid colliding with Agent A's
other `docs/pilot` content.

## What shipped

| Artifact | Purpose |
| --- | --- |
| `scripts/backup/pg-lib.mjs` | Shared plumbing: env/connection resolution, pg client-tool locator, the production/recovery guard, `PGPASSWORD`-only secret handling. |
| `scripts/backup/backup.mjs` | `pg_dump -Fc` (custom, compressed format) of a database to a timestamped `*.dump`; prints the artifact path + sha256; refuses production/recovery database names. |
| `scripts/backup/restore.mjs` | Creates a FRESH target database and `pg_restore`s into it; refuses to overwrite a populated database without `--force`; verifies object counts post-restore. |
| `scripts/backup/pg-verify.mjs` | Canonical-Postgres verification: attempts PG16, else runs the equivalent battery on the installed PostgreSQL. |
| `tests/runtime/staging/backup-restore.e2e.test.ts` | Real backup + restore-to-fresh + data-survival E2E against a throwaway database. |

## Usage

```
# Back up (custom format) — never dumps a production/recovery-named database.
node scripts/backup/backup.mjs --test --db <src> --user postgres --out <dir>

# Restore into a FRESH target (the script CREATEs it); refuses a populated target without --force.
node scripts/backup/restore.mjs --test --db <target> --user postgres --dump <file.dump>

# Canonical Postgres verification (PG16 attempt + equivalent run).
node scripts/backup/pg-verify.mjs --test
```

Notes:
- The connection password is passed to the pg client tools ONLY via `PGPASSWORD` in the child
  environment — never on a command line, never logged.
- Throwaway databases are created/dropped as the `postgres` superuser (the `.env`-derived password
  is shared, per the environment facts). `geoplane_app` intentionally lacks `CREATEDB`.
- Backup artifacts are `*.dump` (gitignored) and default to the OS temp dir, so a backup is never
  committed to the tree.

## Safety guards (proven)

- `backup.mjs` / `restore.mjs` refuse any database whose name matches the production/recovery
  pattern (`prod`, `production`, `prd`, `live`, `recover*` as a `_`/`-`-delimited segment). Verified:
  `geoplane_production_canary` is refused with a non-zero exit (also asserted in the E2E).
- `restore.mjs` refuses to restore over an already-populated database unless `--force` is given.
- Every throwaway database name is unique per run (`geoplane_bkp_src_<suffix>` /
  `geoplane_bkp_dst_<suffix>` / `geoplane_pgverify_<suffix>`) and is dropped at the end. Production
  and recovery-source databases are never touched.

## Backup + restore + data survival — RESULT: PASS

The E2E (`tests/runtime/staging/backup-restore.e2e.test.ts`) proves, against real PostgreSQL:

1. a throwaway source database is created and migrated (0001–0006);
2. rows are seeded across the tenancy + knowledge + geo chains — `user`, `organization`,
   `project`, `knowledge_package`, `knowledge_content`, `opportunity`, `delivery`, `audit_event`
   (plus the full FK chain the `delivery` row requires);
3. `backup.mjs` dumps it to a custom-format archive;
4. `restore.mjs` CREATEs a fresh target and `pg_restore`s into it;
5. connecting to the TARGET, every seeded row is present and identical — including the
   `knowledge_content` extracted TEXT byte-for-byte, the `audit_event` JSONB metadata, and the
   restored append-only trigger on `delivery` (an `UPDATE` is still rejected);
6. both throwaway databases are dropped.

## Environment facts (2026-07-18)

- PostgreSQL **18.3** is installed and running (`C:/Program Files/PostgreSQL/18/bin`, service
  `postgresql-x64-18`, port 5432). `pg_dump` / `pg_restore` / `psql` / `createdb` / `dropdb` present.
- PostgreSQL **16 is NOT installed** — no `C:/Program Files/PostgreSQL/16` directory, no `*-16`
  service, and no server answering on a secondary port (5433/5434 refused).
- Docker daemon is not running (no containerized PG16 available).

## CANONICAL_POSTGRES16_VERIFY = BLOCKED_PENDING_ENV

`pg-verify.mjs` attempted to reach a PostgreSQL 16 binary/instance ONCE (install dir, `*-16`
service, secondary-port server). None was reachable in this environment, so canonical PG16
verification is **BLOCKED_PENDING_ENV** — it must be re-run when a PostgreSQL 16 instance is
provisioned for the pilot (`node scripts/backup/pg-verify.mjs` will auto-detect it and report
`PG16=PASS/FAIL`).

## PG18_EQUIVALENT = PASS

As equivalent evidence, `pg-verify.mjs` ran the SAME battery against the installed PostgreSQL 18
on a throwaway database, all green:

- **migrations-apply** — 0001–0006 apply cleanly and reach 0006.
- **constraints** — a blank `user.email` and a bad `organization.type` are both rejected (CHECKs).
- **triggers** — `knowledge_content` is append-only; `UPDATE` and `DELETE` are both rejected.
- **idempotency** — re-running the migrations applies 0; re-inserting the content-address primary
  key is rejected.
- **restart-read-back** — after closing the pool and opening a fresh connection (simulating a
  process restart), the durable `knowledge_content` text is still present, verbatim.

Re-run the canonical PG16 verification once a PostgreSQL 16 instance is available; until then the
PG18-equivalent evidence above stands in.
