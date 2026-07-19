# Local environment runtime

`LOCAL_ENVIRONMENT_RUNTIME_V1` runs only on loopback and accepts only these exact PostgreSQL
database names:

| Role | Variable | Required database |
|---|---|---|
| runtime | `GEO_DATABASE_URL` | `geoplane_local_runtime` |
| test | `GEO_TEST_DATABASE_URL` | `geoplane_local_test` |
| canary | `GEO_CANARY_DATABASE_URL` | `geoplane_local_canary` |

All three URLs, `SESSION_SIGNING_KEY_CURRENT`, `REVIEW_REFERENCE_KEY_CURRENT`, and the explicit
setting `PROVIDER_RUNTIME_ENABLED=false` belong in the gitignored `.env.local`. Never paste their
values into logs, reports, source files, or shell history. The canary database is retained only for
purpose isolation in this stage; no provider canary is run.

The local preflight verifies Node 20.9 or newer, installed dependencies, exact loopback database
targets, connectivity, migrations 0001 through 0008 on every database, required keys, Provider OFF,
the application port, and at least 1 GiB of free disk space.

After Agent A adds the package shortcuts, the normal sequence is `npm run local:preflight`,
`npm run build:web`, `npm run local:start`, `npm run local:status`, and `npm run local:stop`.
Direct equivalents are the matching files under `scripts/local/`. The managed service binds only to
`127.0.0.1`, forces the Provider flag OFF in its child environment, and writes only PID/port/time plus
local logs under the gitignored `.runtime/local` directory.

Resetting sanitized pilot rows is deliberately destructive and therefore requires the exact token:

```text
node scripts/local/reset-sanitized-pilot.mjs --confirm geoplane_local_runtime
```

The reset refuses non-loopback hosts and all database names except `geoplane_local_runtime`; it
preserves the migration ledger. It does not create or seed identities. Seeding belongs to the
functional-pilot workflow.
