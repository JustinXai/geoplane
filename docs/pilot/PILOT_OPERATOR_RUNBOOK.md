# PILOT_OPERATOR_RUNBOOK — geoplane pilot (Agent F)

Operational procedures for running the geoplane pilot. Every command is copy-pasteable. Secrets are
never placed on a command line or logged — passwords reach the pg client tools only via `PGPASSWORD`
in the child environment (see `scripts/backup/pg-lib.mjs`).

**Golden rules**
- These tools operate on **throwaway/staging** databases only. `backup.mjs`/`restore.mjs` refuse any
  database whose name matches the production/recovery pattern (`prod`, `production`, `prd`, `live`,
  `recover*`).
- The application role `geoplane_app` intentionally lacks `CREATEDB`; database create/drop is done as
  the `postgres` superuser (the `.env`-derived password is shared per the environment facts).
- Authorization is always re-derived server-side; a cookie only asserts *which user*.

---

## 0. Environment (`.env.local`)

| Variable | Purpose |
| --- | --- |
| `GEO_DATABASE_URL` | Runtime database connection (e.g. `geoplane_runtime`). |
| `GEO_TEST_DATABASE_URL` | Throwaway test/pilot database (e.g. `geoplane_pl_f`). |
| `SESSION_SIGNING_KEY_CURRENT` | Active HMAC key for signing session cookies. **Required in production.** |
| `SESSION_SIGNING_KEY_PREVIOUS` | Previous key honoured during a rotation window; empty when no rotation is open. |
| `PROVIDER_RUNTIME_ENABLED` | `false` keeps the controlled-provider runtime OFF (pilot default). Only `true`/`1` turns it on. |

`REVIEW_REFERENCE_KEY_CURRENT` may be set to key the opaque review references separately; when unset
it falls back to `SESSION_SIGNING_KEY_CURRENT`.

---

## 1. Start

```
npm ci                     # install exact locked deps
npm run build:web          # production build (Next.js)
npm start                  # serve the built app
# --- or, for local iteration ---
npm run dev
```

Preflight the gates before promoting a build:

```
npx tsc --noEmit
npm test                   # whole suite (DB-backed suites skip cleanly if no test DB)
```

Readiness endpoint: `GET /api/health/ready` (checks DB reachability, migration currency, and the
provider flag posture).

---

## 2. Migrate

Migrations are `migrations/0001…0008_*.sql`, applied in order and idempotently (a re-run applies 0).
`0008_provider_identity.sql` adds the canonical provider identity columns (`gateway_vendor` /
`model_vendor` / `protocol`) to the append-only `provider_execution` ledger; pre-0008 rows are
backfilled by DDL as `UNKNOWN_LEGACY` / `DEEPSEEK` / `OPENAI_COMPATIBLE` without any row UPDATE.

```
# Runtime database
npm run db:migrate

# Test/pilot database (GEO_TEST_DATABASE_URL)
npm run db:migrate:test
```

Verify the current migration set matches the files on disk (readiness/preflight derive the expected
set dynamically — no hardcoded count).

---

## 3. Backup

Produces a compressed custom-format archive (`*.dump`, gitignored) plus its sha256.

```
# Back up the runtime database (as the superuser so pg_dump can read an app-owned db):
node scripts/backup/backup.mjs --user postgres --out <dir>

# Back up the test/pilot database (GEO_TEST_DATABASE_URL):
node scripts/backup/backup.mjs --test --user postgres --out <dir>

# Back up an explicit database by name:
node scripts/backup/backup.mjs --db <name> --user postgres --out <dir>
```

The command prints `ARTIFACT <path>` and `CHECKSUM sha256 <hex>`. Record both. It refuses to dump a
production/recovery-named database.

---

## 4. Restore (to a FRESH database)

Restore is always into a **fresh** target the script CREATEs; it refuses to overwrite a populated
database without `--force`, and verifies object/row counts post-restore.

```
# Restore into a brand-new target database:
node scripts/backup/restore.mjs --db <fresh-target> --user postgres --dump <file.dump>

# Test-lane base connection (--test) with a fresh target:
node scripts/backup/restore.mjs --test --db <fresh-target> --user postgres --dump <file.dump>
```

Post-restore, the script prints `RESTORED <db> tables=… indexes=… triggers=… rows=…`. Connect and
spot-check business rows (accounts / knowledge_content text / opportunity / delivery / audit_event).
A verified backup→restore→data-survival cycle is exercised by
`tests/pilot/pilot-resilience.e2e.pg.test.ts` and `tests/runtime/staging/backup-restore.e2e.test.ts`.

---

## 5. Rollback (a bad deploy)

The application is stateless across a deploy; the database is the source of truth.

1. **Redeploy the previous known-good build** (revert the app to the prior commit/tag and
   `npm run build:web` + `npm start`). Because migrations are additive and forward-only, a bad
   *application* deploy is rolled back purely by redeploying the previous app — no schema change is
   required if no new migration shipped.
2. **If the bad deploy included a new migration**, restore from the pre-deploy backup into a fresh
   database (section 4) and repoint `GEO_DATABASE_URL`, OR apply the compensating steps captured in
   the migration's own notes. Never hand-edit a shipped migration.
3. Confirm `GET /api/health/ready` is green and re-run `npm test` against the test lane.

Take a fresh backup (section 3) **before** any rollback that touches the database.

---

## 6. Emergency — disable the provider

The controlled-provider runtime is OFF by default and only `true`/`1` enables it. To force it off
immediately:

1. Set `PROVIDER_RUNTIME_ENABLED=false` (or remove it, or set any non-truthy value) in `.env.local` /
   the process environment.
2. Restart the app (`npm start`). On boot the flag resolves OFF; `assertRealProviderCallAllowed()`
   throws `ProviderRuntimeDisabledError` at every real call site, so no real model call can be made.
3. The offline deterministic adapter continues to work (it never touches the network), so content
   compilation via the opaque offline envelope pointer is unaffected.

The default-OFF posture is fail-safe: a missing/misconfigured flag resolves to OFF, not ON.

---

## 7. Emergency — revoke a session

Sessions are re-validated server-side on every request against the persisted `session` row, so a
still-cryptographically-valid cookie cannot bypass revocation.

- **Revoke one session:** set `revoked_at = now()` on the `session` row (via the session repository's
  `revoke`, or `UPDATE session SET revoked_at = now() WHERE id = '<session-id>'`). `resolveSession`
  rejects a revoked row immediately.
- **Invalidate a user's sessions by staleness:** issue a higher-`session_version` session for the
  membership; any older session is then behind the live counter and rejected as stale.
- **Fleet-wide, immediate cookie invalidation (key compromise):** rotate the signing key so that
  *every* outstanding cookie is invalidated at once — see section 8.
- **Idle cutoff:** a session whose cookie was issued more than the idle window ago is rejected even
  while its absolute TTL (12h) has not elapsed.

---

## 8. Session signing-key rotation (routine + emergency)

Two env vars back the key material: `SESSION_SIGNING_KEY_CURRENT` (new cookies are always signed with
this) and `SESSION_SIGNING_KEY_PREVIOUS` (still-live cookies signed with it keep verifying during the
window). A signature is accepted iff it matches CURRENT or (when set) PREVIOUS.

**Routine rotation (no forced logout):**
1. Move the value of `SESSION_SIGNING_KEY_CURRENT` into `SESSION_SIGNING_KEY_PREVIOUS`.
2. Set a fresh random secret as the new `SESSION_SIGNING_KEY_CURRENT`.
3. Restart the app. New cookies sign with the new CURRENT; live cookies signed with the now-PREVIOUS
   key keep verifying for the cookie TTL window (`SESSION_TTL_MS` = 12h).
4. After the TTL window has fully elapsed, clear `SESSION_SIGNING_KEY_PREVIOUS` (set it empty). The old
   key is fully retired; any cookie still bearing it is rejected.

**Emergency rotation (force every user to re-authenticate NOW, e.g. key compromise):**
1. Set a fresh `SESSION_SIGNING_KEY_CURRENT` and leave `SESSION_SIGNING_KEY_PREVIOUS` **empty**.
2. Restart the app. Every outstanding cookie fails signature verification immediately and is rejected
   as "no session" — all users must log in again.

The rotation contract (old cookie verifies during the window, fresh login under the new key works,
old cookie rejected after PREVIOUS is dropped) is verified end-to-end by drill (b) in
`tests/pilot/pilot-resilience.e2e.pg.test.ts`.

---

## 9. Operator-gated procedures

- **Real Provider micro-canary** — set `PROVIDER_API_KEY` and `PROVIDER_RUNTIME_ENABLED=true`, then
  run a single budget-capped generation and confirm exactly one `provider_execution` ledger row (no
  secret/content persisted). **Not part of the default pilot run** (Provider real calls = 0).
- **Canonical PostgreSQL 16 verify** — `node scripts/backup/pg-verify.mjs --test` against a real
  PostgreSQL 16 instance. This host runs PostgreSQL 18.3; provision a PG16 instance first. See
  `docs/pilot/BACKUP_RESTORE_NOTES.md`.
