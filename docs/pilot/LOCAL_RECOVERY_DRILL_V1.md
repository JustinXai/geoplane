# LOCAL_RECOVERY_DRILL_V1

This drill is a deliberately local-only recovery path. It does not access GitHub, a remote API, or
a real provider. It does not truncate the application runtime database. Provider Ledger rows are
treated only as restored historical/offline evidence; the drill never creates a provider call.

## One-command operator path

The operator path is split so backup is read-only against the exact runtime and restore can never
point back at it:

```powershell
$env:LOCAL_ONLY_MODE = 'TRUE'
$env:REMOTE_WRITE = 'FORBIDDEN'
node scripts/local/backup.mjs
node scripts/local/restore-verify.mjs --manifest <manifest-from-backup>
```

`scripts/local/backup.mjs` accepts only loopback `GEO_DATABASE_URL` whose database is exactly
`geoplane_local_runtime`. It creates the dump, checksum, and manifest outside the repository. The
manifest contains only table counts and hashes—not row content or a connection URL. It reads the
business summary before and after `pg_dump` and rejects the evidence if runtime state changed during
backup.

`scripts/local/restore-verify.mjs` accepts no URL, database, dump, checksum, force, or test override.
It reads the artifact and checksum from the manifest, restores only into a nonexistent
`geoplane_local_restore_verify`, then compares hashed readback for migrations, organizations,
users, memberships, projects, knowledge packages and content, opportunities, article briefs and
drafts, distribution plans and publication receipts, deliveries, audit events, historical Provider
Ledger rows, and sessions. It never prints raw business rows.

Neither command imports or invokes Provider code. Provider credential variables are removed from
the PostgreSQL child processes. Real Provider calls and remote-write attempts remain zero.

## Safety boundary

- `LOCAL_ONLY_MODE` must be exactly `TRUE`.
- `REMOTE_WRITE` must be exactly `FORBIDDEN`.
- `GEO_TEST_DATABASE_URL` must point to `localhost`, `127.0.0.1`, or `::1`.
- `--url` is forbidden so credentials cannot appear in a process command line.
- Source database names must match `geoplane_local_drill_source[_suffix]`.
- The target is fixed to `geoplane_local_restore_verify`.
- The target must not already exist. The drill never drops, forces, cleans, or overwrites it.
- The source is read by `pg_dump`; the drill never truncates or mutates it.
- Backup output must be outside the repository, and provider credential variables are removed from
  the backup/restore child-process environment.

These rules intentionally reject `geoplane_runtime`, general test databases, production-like
names, recovery-evidence names, non-loopback hosts, and arbitrary restore targets.

## Run

Prepare a desensitized, dedicated local source database first. Then run:

```powershell
$env:LOCAL_ONLY_MODE = 'TRUE'
$env:REMOTE_WRITE = 'FORBIDDEN'
node scripts/recovery/local-recovery-drill.mjs `
  --source-db geoplane_local_drill_source_operator `
  --user postgres
```

The script:

1. validates the local-only gates, database allowlist, fixed target, and loopback host;
2. refuses an existing `geoplane_local_restore_verify` database;
3. creates a PostgreSQL custom-format backup in the operating-system temporary directory;
4. independently recomputes SHA-256 and writes a sibling `.sha256` evidence file;
5. requires `restore.mjs` to verify that checksum before opening the restore connection;
6. restores into `geoplane_local_restore_verify`;
7. compares source/target table, migration, and historical Provider Ledger row counts;
8. leaves the restored database and checksummed dump in place for inspection.

Success ends with:

```text
LOCAL_RECOVERY_DRILL_V1 PASS REAL_PROVIDER_CALLS=0 REMOTE_WRITE_ATTEMPTS=0
```

Do not report success unless this exact terminal line is produced by a real local PostgreSQL run.

## E2E coverage

`tests/e2e/local-recovery-drill-v1.pg.test.ts` creates only a uniquely named, allowlisted source
database and proves:

- a brand-new application runtime and connection pool read persisted data after the first pool is
  closed;
- routine signing-key rotation accepts the old cookie during the `PREVIOUS` window, signs a fresh
  login with the new `CURRENT`, then rejects the retired old cookie;
- the real `pg_dump` / checksum / `pg_restore` script restores to the fixed verification database;
- restored data is readable through a new application runtime;
- Provider Ledger rows remain zero for the desensitized drill fixture (real provider calls = 0).

If no local test database is configured, Vitest reports this PostgreSQL E2E as skipped. A skipped
run is not recovery evidence and must never be represented as PASS.
