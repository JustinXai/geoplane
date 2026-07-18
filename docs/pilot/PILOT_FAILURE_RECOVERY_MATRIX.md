# PILOT_FAILURE_RECOVERY_MATRIX — geoplane pilot (Agent F)

For each failure the pilot is likely to hit: how it is **detected**, the **recovery** procedure, and
where it is **exercised/covered**. Recovery steps reference `docs/pilot/PILOT_OPERATOR_RUNBOOK.md`
(the Runbook) by section.

Design facts that make recovery safe:
- **The database is the source of truth; the app is stateless across a deploy.** Restart/redeploy
  never loses committed business state (proven by resilience drill (a)).
- **Migrations are additive, forward-only, and idempotent** (a re-run applies 0).
- **Backups are custom-format, checksummed, restore into a FRESH database**, and refuse
  production/recovery-named databases.
- **Sessions are re-validated server-side every request**; a signing-key rotation can invalidate every
  outstanding cookie at once.
- **The provider runtime is default-OFF**; a missing/misconfigured flag resolves OFF, not ON.

---

## Failure → Detection → Recovery

### 1. Database down / unreachable

| | |
| --- | --- |
| **Symptoms** | `GET /api/health/ready` fails; route handlers return 5xx; connection-refused / timeout in logs. |
| **Detection** | Readiness probe red; connection errors from `pg`. Confirm with a direct `psql` to the host/port. |
| **Recovery** | 1) Bring PostgreSQL back (service `postgresql-x64-18`, port 5432). 2) Verify migration currency (`npm run db:migrate` — applies 0 if current). 3) Confirm readiness green. **No data recreation is needed** — committed state is durable and re-reads intact (resilience drill (a)). If the data volume itself is lost, restore from the latest backup into a fresh db (Runbook §4) and repoint `GEO_DATABASE_URL`. |
| **Covered by** | Resilience drill (a) — restart read-back; `pilot-resilience.e2e.pg.test.ts`. |

### 2. Migration drift (schema behind/ahead of the app)

| | |
| --- | --- |
| **Symptoms** | Startup/readiness reports the applied set ≠ files on disk; queries fail on a missing column/table. |
| **Detection** | Readiness/preflight derive the **expected** migration set from `migrations/` dynamically and compare to what's applied; a mismatch is flagged. |
| **Recovery** | 1) If the DB is **behind**: `npm run db:migrate` (idempotent, forward-only) to reach the current set. 2) If the DB is **ahead** of the deployed app (a rolled-back app against a migrated DB): redeploy the matching app build, or restore the pre-migration backup into a fresh db (Runbook §4/§5). **Never hand-edit a shipped migration**; add a new forward migration instead. |
| **Covered by** | `npm run db:migrate[:test]` idempotency; migration-apply is asserted across the DB-backed suites and the PG18-equivalent battery (`BACKUP_RESTORE_NOTES.md`). |

### 3. Provider outage (or a runaway/real-call risk)

| | |
| --- | --- |
| **Symptoms** | Real generation errors/timeouts once the provider runtime is enabled; unexpected latency or cost. |
| **Detection** | `provider_execution` ledger rows show ERROR outcomes / rising latency; adapter error taxonomy codes in logs. |
| **Recovery** | **Immediately disable the provider** (Runbook §6): set `PROVIDER_RUNTIME_ENABLED=false` and restart. The default-OFF guard makes every real call site throw `ProviderRuntimeDisabledError`; the **offline deterministic adapter keeps working** (no network), so content compilation via the opaque offline envelope pointer is unaffected. Re-enable only in a controlled window after the provider recovers. |
| **Covered by** | Pilot invariant "Provider real calls = 0" in `pilot-acceptance.e2e.pg.test.ts` (flag OFF, guard throws, ledger empty). The real-call path is **operator-gated** and not run in the pilot. |

### 4. Session signing-key compromise

| | |
| --- | --- |
| **Symptoms** | Evidence a signing secret leaked; suspicion of forged cookies. |
| **Detection** | Security signal (leaked secret, anomalous sessions). Forged cookies signed with a non-current/non-previous key already fail verification. |
| **Recovery** | **Emergency rotation** (Runbook §8): set a fresh `SESSION_SIGNING_KEY_CURRENT` and leave `SESSION_SIGNING_KEY_PREVIOUS` **empty**, then restart — every outstanding cookie is invalidated at once and all users must re-authenticate. For a single bad session, `revoke` the `session` row (Runbook §7). For a routine, no-logout rotation, use the windowed procedure (CURRENT→PREVIOUS, new CURRENT, drop PREVIOUS after the TTL window). |
| **Covered by** | Resilience drill (b) — rotation window + fresh login + post-drop rejection, end-to-end through the real login route + `resolveSession`. |

### 5. Bad deploy (regression in the app build)

| | |
| --- | --- |
| **Symptoms** | New build shows regressions/errors; readiness may still be green but behaviour is wrong. |
| **Detection** | Failing smoke checks / `npm test` on the candidate; error rate after promotion; `GET /api/health/ready` if the build is structurally broken. |
| **Recovery** | **Roll back** (Runbook §5): redeploy the previous known-good build. Since the app is stateless and migrations are additive, an app-only bad deploy is fully recovered by redeploying the prior app — no schema change needed. If the bad deploy shipped a migration, take a fresh backup, then restore the pre-deploy backup into a fresh db (Runbook §4) or apply the migration's compensating notes. Always re-run `npx tsc --noEmit` + `npm test` + `npm run build:web` before re-promoting. |
| **Covered by** | The full gate battery (typecheck / `vitest run tests/pilot` / `npm test` / `build:web`) — all green this run; see `PILOT_ACCEPTANCE_REPORT.md` §4. |

---

## Recovery preconditions checklist

- [ ] A recent, checksummed backup exists (Runbook §3) and its restore has been verified into a fresh
      db at least once (resilience drill (c) / `backup-restore.e2e.test.ts`).
- [ ] The `postgres` superuser is reachable with the shared password (needed for create/drop during
      restore; `geoplane_app` lacks `CREATEDB`).
- [ ] `pg_dump` / `pg_restore` are on PATH or a known PostgreSQL bin dir.
- [ ] Signing-key material (`SESSION_SIGNING_KEY_CURRENT`/`_PREVIOUS`) is managed out-of-band and
      never committed.
- [ ] The previous known-good app build/tag is redeployable.

## Operator-gated (not covered by the automated pilot run)

- **Real Provider micro-canary** — needs `PROVIDER_API_KEY` + `PROVIDER_RUNTIME_ENABLED=true`.
- **Canonical PostgreSQL 16 verify** — needs a real PG16 instance (`scripts/backup/pg-verify.mjs`);
  this host runs PostgreSQL 18.3.
