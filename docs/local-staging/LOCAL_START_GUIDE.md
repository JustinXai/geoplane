# LOCAL CLOSED-PILOT START GUIDE

Scope: `LOCAL_CLOSED_PILOT_STAGING_V1`. This guide operates only on the local machine. Remote Git operations and real Provider calls are outside this phase.

## Fixed safety posture

- Runtime database: `geoplane_local_runtime`.
- Automated-test database: `geoplane_local_test`; tests may clear this database.
- Canary-purpose database: `geoplane_local_canary`; it remains isolated and no Provider canary is run.
- Restore verification database: `geoplane_local_restore_verify`; it is never an application runtime target.
- `PROVIDER_RUNTIME_ENABLED` must resolve to `false`.
- Automatic human review, article approval, and publication remain disabled.
- Default selected distribution-channel count is zero.
- Only sanitized pilot accounts and documents are permitted.
- The managed launcher serves plain HTTP only on `127.0.0.1`. Its session cookie keeps `HttpOnly`
  and `SameSite=Lax` but omits `Secure` only when all local-only containment flags and the exact
  loopback host are present. Every ordinary production/staging process remains `Secure`-only.

## One-time local inputs

Create the gitignored `.env.local` from the variable-name inventory in `LOCAL_DEPLOYMENT_INPUTS.md`. Never paste its contents into logs, documents, issues, or commits. Confirm that each database URL ends in its exact fixed database name. Use a dedicated non-superuser application role.

Dependencies must already be installed from the lockfile. This phase does not authorize an install that needs network access.

## Check and start

From the integration worktree:

```text
npm run local:preflight
npm run local:start
npm run local:status
```

Preflight must report the correct Node runtime, installed dependencies, four required keys by presence only, provider OFF, exact database purposes, migrations `0001` through `0008`, available port, and sufficient disk space. It must never print a database password or secret.

After startup, require both probes to return HTTP 200:

```text
GET /api/health/live
GET /api/health/ready
```

Use the sanitized account reference completed out of band from `LOCAL_ACCOUNT_REFERENCE_TEMPLATE.md`. Do not record passwords in the repository.

## Seed or reset sanitized pilot data

```text
npm run local:seed
```

The seed command may target only `geoplane_local_runtime`. It is idempotent and must refuse any other database. It creates sanitized identities and content only; it does not approve articles, select channels, publish, or make network calls.

## Stop safely

```text
npm run local:stop
npm run local:status
```

The stop command must remove only the process it started, then confirm the local port is released. It must not stop PostgreSQL and must not delete runtime data.

## Back up and verify recovery

```text
npm run local:backup
npm run local:restore-verify
```

Backup produces a custom-format PostgreSQL archive and SHA-256 checksum outside the repository. Restore verification targets only the fresh `geoplane_local_restore_verify` database and verifies business data; it never repoints or clears `geoplane_local_runtime`.

## Stop boundary

After functional review preparation, stop the app and leave all results in local commits and a local Git bundle. Do not merge into `main`, push, create a PR, deploy publicly, enable Provider runtime, or begin unrelated feature work.
