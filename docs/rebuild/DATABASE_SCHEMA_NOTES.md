# DATABASE_SCHEMA_NOTES_V1

<!--
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
  docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
reconstruction_reason: no original migration was recoverable from
  E:\GEO_RECOVERY_SAFE (see docs/rebuild/RECOVERY_GAP_ANALYSIS.md,
  "Database migrations - Not recovered", P0).
original_file_unavailable: true
-->

Companion notes for `migrations/0001_tenancy_foundation.sql` (checkpoint B3).
Explains the non-obvious design choices in that migration and their
reasoning, so a reviewer doesn't have to reverse-engineer intent from DDL
alone.

## Status: UNTESTED_AGAINST_LIVE_DB

No database connection is available or permitted in the environment this
checkpoint was built in. The migration has been reviewed by eye (column
types against `src/contracts/tenancy/entities.ts`, FK direction and
dependency ordering, trigger/function syntax, constraint semantics) but has
**not** been executed against a live PostgreSQL instance. Treat it as a
strong first draft, not a verified-runnable artifact, until an agent with DB
access runs it against a throwaway database and reports back.

## The CLIENT-single-active-org constraint

This is the single most important constraint in the migration:

> A `CLIENT` user may belong to at most one **ACTIVE** `CLIENT`-type
> Organization at a time. (`SYSTEM_INVARIANTS_V1.md`,
> `MULTI_TENANT_ACCOUNT_MODEL_V1.md`)

`entities.ts` notes that "enforcement lives in the `AuthorizationContext`
service, not just this shape" - but reading `authorization.ts` (checkpoint
B2) shows that service only *consumes* the invariant (it trusts
`ctx.activeClientOrganizationId` as already-resolved, singular). Nothing in
the recovered/reconstructed application layer actually stops a second
`ACTIVE` `CLIENT`-type `membership` row from being inserted. This migration
is what makes that impossible, at the database level, under concurrent
writes.

**Approach: a partial unique index, with a trigger-maintained denormalized
column.**

```sql
CREATE UNIQUE INDEX uq_membership_one_active_client_org_per_user
  ON membership (user_id)
  WHERE status = 'ACTIVE' AND organization_type = 'CLIENT';
```

A Postgres partial unique index enforces uniqueness of the indexed column(s)
only among rows matching the `WHERE` predicate. Here that means: among a
given `user_id`'s `membership` rows where `status = 'ACTIVE'` and
`organization_type = 'CLIENT'`, at most one may exist. A second `INSERT` or
`UPDATE` that would produce a second such row raises a real
`unique_violation` (SQLSTATE `23505`) - not an application-level check that
races under concurrency, an actual database constraint.

The complication: **partial index predicates cannot reference another
table.** The organization's `type` lives on `organization`, not on
`membership`, and there is no way to write `WHERE status = 'ACTIVE' AND
(SELECT type FROM organization WHERE id = organization_id) = 'CLIENT'` as an
index predicate. So `organization_type` is denormalized directly onto
`membership`, and two triggers keep it from ever drifting out of sync with
its source of truth:

1. `membership_sync_organization_type` (`BEFORE INSERT OR UPDATE OF
   organization_id ON membership`) always overwrites
   `NEW.organization_type` with the current `organization.type` for
   `NEW.organization_id`, looked up fresh on every write. Application code's
   own value for that column, if it supplies one at all, is discarded -
   this column is not independently writable in practice, even though
   nothing at the SQL grant level stops a write to it directly.
2. `organization_type_change_cascade` (`AFTER UPDATE OF type ON
   organization`) back-fills every `membership` row for that organization if
   its `type` is ever changed after creation, so the mirror can't go stale
   after the fact (organization type changes should be rare/administrative,
   but the schema doesn't assume they never happen).

Together, `organization_type` on `membership` behaves as a trigger-computed
mirror of `organization.type`, not a second, independently-trustworthy
source of truth - so the partial unique index above is a faithful
enforcement of "the owning organization is CLIENT-type", not merely
"someone once wrote CLIENT into this row".

This is a standard, well-known Postgres pattern for expressing a
cross-table condition inside a partial index predicate (denormalize +
trigger-sync the discriminant column), chosen over the alternatives:

- **A single global check-then-insert in application code** - rejected:
  races under concurrent requests, exactly the failure mode this constraint
  exists to prevent.
- **A `BEFORE INSERT` trigger that runs `SELECT COUNT(*) ... FOR UPDATE`
  against `membership`** - works, but needs careful row-locking to be
  concurrency-safe and duplicates what a unique index already guarantees
  for free; a unique index is the more idiomatic and cheaper mechanism.
- **A native Postgres `ENUM` for `organization_type` instead of `TEXT` +
  `CHECK`** - considered and rejected for consistency with the rest of the
  migration; see "Enums as TEXT + CHECK" below.

## Enums as TEXT + CHECK, not native Postgres ENUM types

Every union-typed field in `entities.ts` (`OrganizationType`,
`OrganizationStatus`, `PlatformRole`, `MembershipStatus`, `InvitationStatus`,
`ClientReviewDecisionValue`, the review `subjectType`) is modeled as
`TEXT NOT NULL` plus a `CHECK (... IN (...))` constraint, rather than a
native `CREATE TYPE ... AS ENUM (...)`.

Reasoning: adding a value to a Postgres native enum used to require running
`ALTER TYPE ... ADD VALUE` outside a transaction block (relaxed in newer
Postgres versions, but still has sharp edges around concurrent use in the
same transaction), and enum values can't be removed at all without
recreating the type. `entities.ts` is explicitly still moving (see the
B1-CORRECTION note replacing `REJECTED` with `CHANGES_REQUESTED` on
`ClientReviewDecisionValue` - exactly the kind of change that's painful with
a native enum type and a single `ALTER TABLE ... DROP CONSTRAINT` /
`ADD CONSTRAINT` with a text column. Given this schema is still being
reconstructed from a frozen spec and may need to evolve as more evidence
surfaces, `TEXT + CHECK` was chosen for lower-friction future migrations at
a small, acceptable cost in storage/index size versus native enums.

## `displayName` is deliberately not unique; `idempotencyKey` is

Per `SYSTEM_INVARIANTS_V1.md`: "display names must not be used as a unique
key." `organization.display_name` has a `CHECK` guarding against blank
values only (`length(trim(display_name)) > 0`) and **no** `UNIQUE`
constraint - this is intentional, not an oversight, and is called out with
an inline comment in the migration so a later reviewer doesn't "fix" it by
adding one.

The real create-idempotency key is `organization.idempotency_key`, which
does carry a genuine `UNIQUE` constraint
(`uq_organization_idempotency_key`). `entities.ts` also documents
`sourceNamespace` + `externalReference` as a future stronger identity
contract for externally-originated organizations; those two columns are
present (nullable) but intentionally carry no uniqueness constraint yet,
matching the entity comment: "Neither is enforced yet at this checkpoint -
fields only."

## Polymorphic references are not foreign keys

`client_review_decision.subject_id` (a `KEYWORD` / `CONTENT_DIRECTION` /
`SOURCE_TYPE` row) and `artifact_index.artifact_id` (an article draft,
evidence seal, etc.) both point at rows in tables that belong to other
modules outside checkpoint B3's scope (tenancy/auth only). They're typed
`UUID NOT NULL` to match the `string` field in `entities.ts`, but are
intentionally not `REFERENCES` foreign keys, since the target tables don't
exist yet in this migration. A future checkpoint that owns those tables
could add the FK once both sides exist; documented here so it doesn't read
as a missed constraint.

## `artifact_index` is append-only, enforced at the database level

`entities.ts`'s comment on `ArtifactIndex` is explicit: "Immutable index...
Append-only: `SYSTEM_INVARIANTS_V1.md` forbids modifying historical business
artifacts." Rather than rely on application discipline alone, `UPDATE` and
`DELETE` on `artifact_index` are blocked by `BEFORE` triggers
(`trg_artifact_index_forbid_update` / `trg_artifact_index_forbid_delete`)
that unconditionally raise an exception. `audit_event` is conventionally
also append-only (it's an audit log), but that's not spelled out as
explicitly in `entities.ts` as it is for `ArtifactIndex`, so no DB-level
mutation guard was added there in this checkpoint - noted here as a
candidate for a future migration if that invariant is confirmed.

## Known limitation: cross-table type invariants beyond the CLIENT-org one

Two relationships have an implied type constraint that this migration does
**not** enforce at the database level, because a plain `CHECK` constraint
cannot reference another table's columns in Postgres, and adding
trigger-based enforcement for all of them was judged out of scope for B3 (a
straightforward follow-up if needed, using the same
denormalize-and-trigger-sync pattern as the CLIENT-single-active-org
constraint above):

- `agency_client_assignment.agency_organization_id` should reference an
  `organization` with `type = 'AGENCY'`, and `client_organization_id` should
  reference one with `type = 'CLIENT'`.
- `project.client_organization_id` should reference an `organization` with
  `type = 'CLIENT'`.

Both are currently real foreign keys (referential integrity to
`organization.id` is enforced), just not type-scoped ones. Application code
(`src/contracts/tenancy/authorization.ts` and its callers) must continue to
validate `organization.type` before writing these rows until/unless a
future checkpoint adds DB-level enforcement.

## ID and timestamp type choices

- All entity `id` fields and foreign-key columns: `UUID`, defaulting to
  `gen_random_uuid()` (via the `pgcrypto` extension) for primary keys. The
  TS contracts type these as `string`; `UUID` was chosen over plain `TEXT`
  because every id in `entities.ts` is used as an opaque identifier/FK
  target, never a human-readable string, and native `UUID` gives real type
  checking on FK columns plus a smaller on-disk/index footprint than text.
- All `...At` fields (`createdAt`, `expiresAt`, `revokedAt`, `assignedAt`,
  `decidedAt`, `sealedAt`): `TIMESTAMPTZ`, matching the ISO-8601 string
  contract in TS while storing an unambiguous instant.
- `sessionVersion`, `targetVersion`, `artifactVersion` (`number` in TS):
  `INTEGER`, with non-negative `CHECK` constraints where the field is a
  monotonically increasing counter/version.
- `AuditEvent.metadata` (`Record<string, unknown> | null`): `JSONB`, the
  natural Postgres mapping for an arbitrary JSON-shaped bag of data.
