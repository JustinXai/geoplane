# STAGING OPERATIONS AUDIT — preflight / health / logging / backup-restore

Read-only supervisor audit at pilot HEAD `3d2da9c`. Scope: canonical-Postgres verification,
backup + restore-to-fresh, health probes, structured logging redaction, and the deployment
preflight. This audit found **0 REAL violations**; two items are KNOWN-ENV-GATEs.

Corroboration: `tests/runtime/staging/*` (logger, health-live, preflight, health-ready) and
`backup-restore.e2e.test.ts` were executed and **all pass** (backup/restore E2E: 7/7);
`tsc --noEmit` is clean.

---

## 1. Canonical PostgreSQL 16 verification — **BLOCKED_PENDING_OPERATOR** (documented, acceptable)

- PostgreSQL **16 is not installed** in this environment (no `…/PostgreSQL/16`, no `*-16`
  service, no secondary-port server, no Docker) — `docs/pilot/BACKUP_RESTORE_NOTES.md:63-77`.
- `scripts/backup/pg-verify.mjs` attempts a PG16 binary/instance once and, finding none,
  reports `CANONICAL_POSTGRES16_VERIFY = BLOCKED_PENDING_ENV` — re-run when a PG16 instance is
  provisioned — `docs/pilot/BACKUP_RESTORE_NOTES.md:71-77`.
- **PG18-equivalent battery = PASS** (migrations-apply, constraints, append-only triggers,
  idempotency, restart-read-back) stands in as documented equivalent evidence —
  `docs/pilot/BACKUP_RESTORE_NOTES.md:81-93`.

This is a KNOWN-ENV-GATE (`BLOCKED_PENDING_OPERATOR`), not a failure of the build.

## 2. Backup + restore-to-fresh actually restores data (E2E) — **PASS**

`tests/runtime/staging/backup-restore.e2e.test.ts` proves, against real PostgreSQL, an
end-to-end round trip (executed here: **7/7 pass**):

1. create a throwaway source DB, apply all migrations, seed the full tenancy→knowledge→geo FK
   chain incl. `knowledge_content` extracted TEXT and `audit_event` JSONB —
   `tests/runtime/staging/backup-restore.e2e.test.ts:87-244`, `250-291`;
2. `scripts/backup/backup.mjs` `pg_dump -Fc` to a custom-format archive;
3. `scripts/backup/restore.mjs` **CREATEs a fresh target** and `pg_restore`s into it;
4. connecting to the **target**, every seeded row is present and identical — the
   `knowledge_content` text **byte-for-byte**, the `audit_event` JSONB, and the restored
   **append-only trigger** on `delivery` (an `UPDATE` is still rejected) —
   `tests/runtime/staging/backup-restore.e2e.test.ts:303-392`.
5. `backup.mjs` **refuses a production/recovery-named database** (`geoplane_production_canary`
   → non-zero exit) — `tests/runtime/staging/backup-restore.e2e.test.ts:394-410`;
   `restore.mjs` rejects existing targets and `--force`, and every
   throwaway DB name is unique per run and dropped — `docs/pilot/BACKUP_RESTORE_NOTES.md:38-46`.

Password handling: the connection password is passed to the client tools **only** via
`PGPASSWORD` in the child environment — never on a command line, never logged —
`docs/pilot/BACKUP_RESTORE_NOTES.md:30-34`.

## 3. Health probes — live / ready correct — **PASS**

- **Liveness** `GET /api/health/live`: always `200 {status:"live"}`, **no dependency checks**
  and `cache-control: no-store`, so an orchestrator never kills a healthy pod during a
  dependency blip — `src/app/api/health/live/route.ts:1-18`.
- **Readiness** `GET /api/health/ready`: runs the blocker checks (database reachable,
  migrations current, required env present, file-storage reachable) and returns **200** when
  all pass, **503** with a per-check breakdown otherwise; provider-flag state is reported as a
  non-blocker — `src/runtime/observability/readiness.ts:74-90`,
  `src/runtime/observability/preflight.ts:391-409`.
- The readiness body carries only check names / statuses / **secret-free** detail strings —
  never a DB URL or key — `src/runtime/observability/readiness.ts:8-11`, `73-90`.

Verified by `tests/runtime/staging/health-live.test.ts` and `.../health-ready.pg.test.ts`
(pass).

## 4. Structured logger redacts sensitive text — **PASS**

Two independent layers — `src/runtime/observability/logger.ts:8-19`:

- **Allowlist projection**: the emitted record is built from a fixed field set; any extra
  top-level field (cookie/token/apiKey/…) a caller passes is simply never copied out —
  `src/runtime/observability/logger.ts:154-192`.
- **Deep redaction guard**: the optional free-form `context` bag is deep-walked and any key
  matching a forbidden pattern is replaced with `[REDACTED]` — covering
  cookie / token / api-key / authorization / bearer / secret / password / signing-key /
  session-key / **prompt** / **completion** / **provider-response** / **knowledge-text** /
  raw-text / content-text / extracted-text — `src/runtime/observability/logger.ts:77-128`.

Verified by `tests/runtime/staging/logger.test.ts` (pass).

## 5. Deployment preflight — **PASS** (one cosmetic doc nit)

`runPreflightChecks` runs environment, session-key (weak/placeholder key is a blocker FAIL in
production, WARN otherwise), database, migrations, file-storage, and provider-disabled (WARN,
never a blocker) — `src/runtime/observability/preflight.ts:174-257`, `391-409`.

- **Migration version is DERIVED at runtime** from the `migrations/` directory, so a newly
  added migration (0007, …) never requires editing the check — `CURRENT_MIGRATION_VERSION`
  correctly resolves to **0007** at HEAD — `src/runtime/observability/preflight.ts:132-144`,
  `298-349`. The CLI mirror `scripts/preflight/preflight.mjs:26-33` derives the same set.
- The migrator applies **all** `NNNN_*.sql` files sorted, so 0007 is applied —
  `src/persistence/pg/migrator.ts:37-39`.

**Cosmetic doc nit (not a REAL violation, not behavioral):** three human-facing strings still
say "0006"/"0001-0006" — the ready-route header `src/app/api/health/ready/route.ts:6`, the
`checkMigrations` docstring `src/runtime/observability/preflight.ts:298`, and a detail string
in `scripts/preflight/preflight.mjs:122`. The **logic derives the current version dynamically**
and includes 0007, so behavior is correct; only the comments are stale. Recommend a one-line
comment refresh (optional, non-blocking).

---

## Verdict — STAGING OPERATIONS: PASS_WITH_CHANGES

Backup/restore E2E, health probes, logger redaction, and preflight all PASS with zero REAL
violations. Outstanding: (a) canonical **PG16** verification is `BLOCKED_PENDING_OPERATOR`
(PG16 not installed; PG18-equivalent evidence PASS), and (b) optional cosmetic refresh of three
stale "0006" comments. Neither is a build failure.
