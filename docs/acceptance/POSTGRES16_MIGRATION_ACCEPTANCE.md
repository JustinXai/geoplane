# POSTGRES16_MIGRATION_ACCEPTANCE

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 六.
Status: **DEFERRED**, not run this session.

## Why

This phase requires verification against a real, isolated PostgreSQL 16
(Docker container or standalone test database) — never a production,
recovery, or old development database. Docker Desktop was launched but its
Linux engine could not start:

```
error during connect: Get "http://.../dockerDesktopLinuxEngine/...":
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

Root cause identified via `wsl --status`: WSL2 needs a kernel update
(`wsl --update`), which Docker Desktop's Linux container backend depends
on. This typically requires the update plus a system restart to take
effect — not something resolvable from within this session.

Given this, the project owner chose (2026-07-19, this session) to defer
section 六 rather than block the rest of this acceptance phase on it, and
to continue with sections 七 onward.

## Current status carried forward

`Migration Verify` remains **UNTESTED_AGAINST_LIVE_DB** — the same status
recorded in the overnight rebuild's final report
(`docs/rebuild/OVERNIGHT_REBUILD_REPORT.md`). `migrations/0001_tenancy_foundation.sql`
has been reviewed by eye (checkpoint B3) and its core invariant — "a CLIENT
user may belong to at most one ACTIVE CLIENT organization" — has been
independently proven correct in application code by
`InMemoryTenancyRepository.createMembership` (checkpoint B5) and exercised
again by this phase's composition-root E2E test. Neither of those is a
substitute for running the actual DDL against a real PostgreSQL 16
instance.

## What section 六 still requires once unblocked

All of the following remain outstanding and must be run before `Migration
Verify` can honestly become `PASS`:

- Apply `migrations/0001_tenancy_foundation.sql` in full against a
  disposable PostgreSQL 16 instance.
- Schema/constraint/trigger verification (every `CHECK`, `UNIQUE`, and the
  two `membership_sync_organization_type`/`organization_type_change_cascade`
  triggers actually fire as designed).
- Concurrent idempotency verification: 10 concurrent `createOrganization`
  calls with the same idempotency key must produce exactly one row.
- A CLIENT user attempting to join a second ACTIVE CLIENT organization
  must be rejected by the database itself (the partial unique index), not
  merely by application code.
- Same display name + different external reference → allowed. Same
  namespace + external reference → duplicate rejected.
- `UPDATE`/`DELETE` against `artifact_index` → both rejected by the
  append-only triggers.
- An unauthorized agency assignment → cannot read the client's project
  (this specific check is a join across `agency_client_assignment` and
  `project`/`organization`, not yet modeled as a single query anywhere in
  this codebase — worth scoping as its own test query when this section
  resumes, not assumed to already exist).

## Exact next action to unblock

1. On the host: `wsl --update`, then restart if prompted.
2. Confirm `docker ps` succeeds (no connection error).
3. Resume this phase at section 六 specifically — everything else in this
   phase does not depend on it and has continued in parallel.
