-- ============================================================================
-- Migration: 0001_tenancy_foundation
-- Checkpoint: B3 - Database schema & migration contract
--
-- Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
-- reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md,
--   docs/governance/SYSTEM_INVARIANTS_V1.md, src/contracts/tenancy/entities.ts
--   (checkpoint B1 / B1-CORRECTION), src/contracts/tenancy/authorization.ts
--   (checkpoint B2).
-- reconstruction_reason: no original migration file, schema SQL, or
--   CREATE TABLE/pgTable definition was recoverable from E:\GEO_RECOVERY_SAFE
--   (see docs/rebuild/RECOVERY_GAP_ANALYSIS.md, "Database migrations - Not
--   recovered", P0).
-- original_file_unavailable: true
--
-- Dialect: PostgreSQL (recovered evidence referenced postgresql:// URLs).
-- Status: UNTESTED_AGAINST_LIVE_DB. No database connection is available or
--   permitted in this environment. This file has been reviewed by eye for
--   syntactic soundness, FK direction/cycles, and constraint semantics, but
--   has NOT been executed against a live Postgres instance. See
--   docs/rebuild/DATABASE_SCHEMA_NOTES.md for the full design writeup,
--   including the CLIENT-single-active-org constraint approach.
--
-- Scope: schema only. No seed data, no fixtures, no fake or real customer
-- data of any kind.
--
-- Design note on array-typed fields: none of the 11 entities in
-- src/contracts/tenancy/entities.ts that this migration covers has a
-- `string[]` field. The only array-typed fields in that file
-- (assignedClientOrganizationIds / allowedClientOrganizationIds on
-- AuthorizationContext) belong to a request-scoped, server-computed struct,
-- not a persisted entity - it is derived at read time from
-- agency_client_assignment rows (see authorization.ts) and therefore has no
-- table of its own here. If a future checkpoint needs a persisted
-- string-list field, the intended pattern in this schema is a normalized
-- join table (as used throughout below for one-to-many relationships), not
-- a native `text[]` column, to keep referential integrity enforceable via
-- real foreign keys.
-- ============================================================================

BEGIN;

-- gen_random_uuid() for id defaults.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- User
-- ----------------------------------------------------------------------------
CREATE TABLE "user" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_email UNIQUE (email),
  CONSTRAINT ck_user_email_not_blank CHECK (length(trim(email)) > 0)
);

-- ----------------------------------------------------------------------------
-- Organization
-- ----------------------------------------------------------------------------
CREATE TABLE organization (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT NOT NULL,
  -- Deliberately NOT unique and NOT a business/lookup key. Per
  -- SYSTEM_INVARIANTS_V1.md: "display names must not be used as a unique
  -- key". The CHECK below only guards against blank values; real
  -- create-idempotency uniqueness lives on idempotency_key (see below), not
  -- here. Do not add a UNIQUE constraint to this column in a later
  -- migration without an explicit invariant change.
  display_name         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  -- Idempotency key for creation requests (entities.ts Organization.idempotencyKey).
  idempotency_key      TEXT NOT NULL,
  -- Reserved for a future stronger identity contract (sourceNamespace +
  -- externalReference as the real unique key for externally-originated
  -- orgs). Neither is enforced yet at this checkpoint - fields only, per
  -- entities.ts comment.
  source_namespace     TEXT NULL,
  external_reference   TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id   UUID NOT NULL REFERENCES "user"(id),

  CONSTRAINT ck_organization_type CHECK (type IN ('PLATFORM', 'AGENCY', 'CLIENT')),
  CONSTRAINT ck_organization_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  CONSTRAINT ck_organization_display_name_not_blank CHECK (length(trim(display_name)) > 0),
  -- The one real uniqueness key for creation-idempotency.
  CONSTRAINT uq_organization_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX ix_organization_created_by_user_id ON organization(created_by_user_id);
CREATE INDEX ix_organization_type ON organization(type);

-- ----------------------------------------------------------------------------
-- Membership
-- ----------------------------------------------------------------------------
CREATE TABLE membership (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES "user"(id),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  role              TEXT NOT NULL,
  status            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Denormalized copy of organization.type, maintained ONLY by the trigger
  -- functions below (membership_sync_organization_type /
  -- organization_type_change_cascade). Application code must never write to
  -- this column directly - it exists purely so the partial unique index
  -- below can express a cross-table invariant, since Postgres partial index
  -- predicates cannot contain subqueries or reference other tables.
  organization_type TEXT NOT NULL,

  CONSTRAINT ck_membership_role CHECK (role IN ('PLATFORM_SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_OPERATOR', 'CLIENT_OWNER')),
  CONSTRAINT ck_membership_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  CONSTRAINT ck_membership_organization_type CHECK (organization_type IN ('PLATFORM', 'AGENCY', 'CLIENT')),
  -- One membership row per (user, organization) - prevents duplicate rows
  -- that would otherwise complicate the ACTIVE-count reasoning below.
  CONSTRAINT uq_membership_user_organization UNIQUE (user_id, organization_id)
);

CREATE INDEX ix_membership_user_id ON membership(user_id);
CREATE INDEX ix_membership_organization_id ON membership(organization_id);

-- ---- THE key invariant of this migration --------------------------------
-- "A CLIENT user may belong to at most one ACTIVE CLIENT-type Organization
-- at a time" (SYSTEM_INVARIANTS_V1.md; MULTI_TENANT_ACCOUNT_MODEL_V1.md;
-- referenced but NOT enforced in src/contracts/tenancy/entities.ts, which
-- says enforcement "lives in the AuthorizationContext service" - that
-- service only *reads* the fact at session-resolution time, it does not
-- prevent a second row from being written. This migration is what actually
-- makes a second row impossible.)
--
-- Approach: a partial UNIQUE INDEX on membership(user_id), scoped to rows
-- where status = 'ACTIVE' AND organization_type = 'CLIENT'. Postgres allows
-- at most one row satisfying a partial unique index's predicate per key
-- value, so a second concurrent INSERT or UPDATE that would produce a
-- second ACTIVE CLIENT-type membership for the same user raises a real
-- unique_violation (SQLSTATE 23505) at the database level - it is not
-- merely checked in application code, and it holds even under concurrent
-- writes (unlike a check-then-insert done in the application layer).
--
-- Partial index predicates cannot join to another table, so this requires
-- organization_type to live on the membership row itself. To keep that
-- denormalized column from silently drifting away from organization.type
-- (which would either let the invariant leak a violation through, or wrongly
-- block a legitimate insert), two triggers keep it in sync automatically:
--
--   1. membership_sync_organization_type (BEFORE INSERT OR UPDATE OF
--      organization_id ON membership) overwrites NEW.organization_type from
--      the current organization.type on every insert or reparenting update,
--      so whatever the caller passes for organization_type is never
--      trusted - it is always recomputed from the source of truth.
--   2. organization_type_change_cascade (AFTER UPDATE OF type ON
--      organization) back-fills membership.organization_type for every
--      existing membership row if an organization's type is ever changed
--      after the fact, so the column can't go stale post-write either.
--
-- Together these make organization_type a trigger-maintained mirror rather
-- than an independently-writable column, so the partial unique index below
-- is a faithful, tamper-resistant enforcement of "status = ACTIVE AND the
-- owning organization is CLIENT-type" - not just "status = ACTIVE AND
-- someone wrote CLIENT into this row once".
CREATE OR REPLACE FUNCTION membership_sync_organization_type() RETURNS TRIGGER AS $$
BEGIN
  SELECT type INTO STRICT NEW.organization_type
  FROM organization
  WHERE id = NEW.organization_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_membership_sync_organization_type
  BEFORE INSERT OR UPDATE OF organization_id ON membership
  FOR EACH ROW EXECUTE FUNCTION membership_sync_organization_type();

CREATE OR REPLACE FUNCTION organization_type_change_cascade() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    UPDATE membership
    SET organization_type = NEW.type
    WHERE organization_id = NEW.id
      AND organization_type IS DISTINCT FROM NEW.type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organization_type_change_cascade
  AFTER UPDATE OF type ON organization
  FOR EACH ROW EXECUTE FUNCTION organization_type_change_cascade();

-- The invariant itself: at most one ACTIVE, CLIENT-type membership row per user.
CREATE UNIQUE INDEX uq_membership_one_active_client_org_per_user
  ON membership (user_id)
  WHERE status = 'ACTIVE' AND organization_type = 'CLIENT';

-- ----------------------------------------------------------------------------
-- AgencyClientAssignment
-- ----------------------------------------------------------------------------
CREATE TABLE agency_client_assignment (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_organization_id  UUID NOT NULL REFERENCES organization(id),
  client_organization_id  UUID NOT NULL REFERENCES organization(id),
  status                  TEXT NOT NULL,
  assigned_by_user_id     UUID NOT NULL REFERENCES "user"(id),
  assigned_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at              TIMESTAMPTZ NULL,

  CONSTRAINT ck_agency_client_assignment_status CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT ck_agency_client_assignment_distinct_orgs CHECK (agency_organization_id <> client_organization_id),
  CONSTRAINT ck_agency_client_assignment_revoked_at CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL) OR
    (status = 'ACTIVE' AND revoked_at IS NULL)
  )
  -- NOTE: agency_organization_id.type = 'AGENCY' and
  -- client_organization_id.type = 'CLIENT' are NOT enforced here - a plain
  -- CHECK constraint cannot reference another table's columns in Postgres.
  -- Documented as a known limitation in docs/rebuild/DATABASE_SCHEMA_NOTES.md;
  -- a follow-up checkpoint could add BEFORE INSERT/UPDATE triggers mirroring
  -- the membership_sync_organization_type pattern above if this needs
  -- DB-level enforcement rather than application-level enforcement.
);

CREATE INDEX ix_agency_client_assignment_agency_org ON agency_client_assignment(agency_organization_id);
CREATE INDEX ix_agency_client_assignment_client_org ON agency_client_assignment(client_organization_id);

-- Only one ACTIVE assignment row per (agency, client) pair - keeps the
-- "explicit assignment" allow-list computation in authorization.ts
-- (allowedClientOrganizationIds) free of duplicate rows for the same grant.
CREATE UNIQUE INDEX uq_agency_client_assignment_active_pair
  ON agency_client_assignment (agency_organization_id, client_organization_id)
  WHERE status = 'ACTIVE';

-- ----------------------------------------------------------------------------
-- Project
-- ----------------------------------------------------------------------------
CREATE TABLE project (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  name                     TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),

  CONSTRAINT ck_project_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX ix_project_client_organization_id ON project(client_organization_id);

-- ----------------------------------------------------------------------------
-- ProjectMembership
-- ----------------------------------------------------------------------------
CREATE TABLE project_membership (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES project(id),
  user_id      UUID NOT NULL REFERENCES "user"(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_project_membership_project_user UNIQUE (project_id, user_id)
);

CREATE INDEX ix_project_membership_project_id ON project_membership(project_id);
CREATE INDEX ix_project_membership_user_id ON project_membership(user_id);

-- ----------------------------------------------------------------------------
-- Invitation
-- ----------------------------------------------------------------------------
CREATE TABLE invitation (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organization(id),
  invited_email        TEXT NOT NULL,
  role                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  -- Never the raw token - see docs/rebuild/SECURITY_IMPORT_REPORT.md and
  -- entities.ts Invitation.tokenHash. This column stores a hash only.
  token_hash           TEXT NOT NULL,
  created_by_user_id   UUID NOT NULL REFERENCES "user"(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ NULL,
  revoked_by_user_id   UUID NULL REFERENCES "user"(id),

  CONSTRAINT ck_invitation_role CHECK (role IN ('PLATFORM_SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_OPERATOR', 'CLIENT_OWNER')),
  CONSTRAINT ck_invitation_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT ck_invitation_invited_email_not_blank CHECK (length(trim(invited_email)) > 0),
  CONSTRAINT ck_invitation_revoked_fields CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL) OR (status <> 'REVOKED')
  )
);

CREATE INDEX ix_invitation_organization_id ON invitation(organization_id);
CREATE UNIQUE INDEX uq_invitation_token_hash ON invitation(token_hash);

-- ----------------------------------------------------------------------------
-- Session
-- ----------------------------------------------------------------------------
CREATE TABLE session (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID NOT NULL REFERENCES "user"(id),
  membership_id                   UUID NOT NULL REFERENCES membership(id),
  organization_id                 UUID NOT NULL REFERENCES organization(id),
  -- Snapshot of the role at session-issue time (entities.ts Session.role) -
  -- deliberately independent of membership.role going forward; see
  -- session_version below for how staleness against the live membership is
  -- detected.
  role                             TEXT NOT NULL,
  -- Snapshot of the CLIENT_OWNER's single ACTIVE client org at
  -- session-issue time. NULL for non-CLIENT_OWNER sessions.
  active_client_organization_id   UUID NULL REFERENCES organization(id),
  active_project_id               UUID NULL REFERENCES project(id),
  -- Incremented whenever the underlying membership/role/assignment set
  -- changes, so a still-valid-looking session token can be rejected if the
  -- authorization facts it was issued against are stale.
  session_version                 INTEGER NOT NULL DEFAULT 0,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                      TIMESTAMPTZ NOT NULL,
  revoked_at                      TIMESTAMPTZ NULL,

  CONSTRAINT ck_session_role CHECK (role IN ('PLATFORM_SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_OPERATOR', 'CLIENT_OWNER')),
  CONSTRAINT ck_session_version_nonnegative CHECK (session_version >= 0),
  CONSTRAINT ck_session_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX ix_session_user_id ON session(user_id);
CREATE INDEX ix_session_membership_id ON session(membership_id);
CREATE INDEX ix_session_organization_id ON session(organization_id);

-- ----------------------------------------------------------------------------
-- ClientReviewDecision
-- ----------------------------------------------------------------------------
CREATE TABLE client_review_decision (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES project(id),
  subject_type             TEXT NOT NULL,
  -- Polymorphic reference: the KEYWORD / CONTENT_DIRECTION / SOURCE_TYPE row
  -- lives in a different module's tables that are out of scope for this
  -- checkpoint (B3 covers tenancy/auth only), so this is intentionally not a
  -- foreign key. Same reasoning as artifact_index.artifact_id below.
  subject_id               UUID NOT NULL,
  -- B1-CORRECTION: REJECTED was replaced with CHANGES_REQUESTED - a client
  -- rejecting a keyword/direction/source asks for changes, it does not veto
  -- the project outright.
  decision                 TEXT NOT NULL,
  reviewer_role            TEXT NOT NULL,
  acting_organization_id   UUID NOT NULL REFERENCES organization(id),
  target_version           INTEGER NOT NULL,
  comment                  TEXT NULL,
  -- Hash of (subjectId, targetVersion, decision, comment) - tamper-evidence
  -- for the decision record.
  decision_hash            TEXT NOT NULL,
  decided_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  decided_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_client_review_decision_subject_type CHECK (subject_type IN ('KEYWORD', 'CONTENT_DIRECTION', 'SOURCE_TYPE')),
  CONSTRAINT ck_client_review_decision_value CHECK (decision IN ('CONFIRMED', 'CHANGES_REQUESTED', 'DEFERRED')),
  CONSTRAINT ck_client_review_decision_reviewer_role CHECK (reviewer_role IN ('PLATFORM_SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_OPERATOR', 'CLIENT_OWNER')),
  CONSTRAINT ck_client_review_decision_target_version_nonnegative CHECK (target_version >= 0)
);

CREATE INDEX ix_client_review_decision_project_id ON client_review_decision(project_id);
CREATE INDEX ix_client_review_decision_subject ON client_review_decision(subject_type, subject_id);

-- ----------------------------------------------------------------------------
-- AuditEvent
-- ----------------------------------------------------------------------------
CREATE TABLE audit_event (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organization(id),
  actor_user_id            UUID NOT NULL REFERENCES "user"(id),
  actor_organization_id    UUID NOT NULL REFERENCES organization(id),
  client_organization_id   UUID NULL REFERENCES organization(id),
  project_id               UUID NULL REFERENCES project(id),
  action                   TEXT NOT NULL,
  target_type              TEXT NULL,
  target_id                TEXT NULL,
  -- Record<string, unknown> | null -> JSONB, the natural Postgres mapping
  -- for an arbitrary, application-defined JSON-shaped metadata bag.
  metadata                 JSONB NULL,
  -- Hash of (action, targetType, targetId, actorUserId, createdAt) for
  -- tamper-evidence.
  event_hash               TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_audit_event_action_not_blank CHECK (length(trim(action)) > 0)
);

CREATE INDEX ix_audit_event_organization_id ON audit_event(organization_id);
CREATE INDEX ix_audit_event_actor_user_id ON audit_event(actor_user_id);
CREATE INDEX ix_audit_event_client_organization_id ON audit_event(client_organization_id);
CREATE INDEX ix_audit_event_project_id ON audit_event(project_id);
CREATE INDEX ix_audit_event_created_at ON audit_event(created_at);

-- ----------------------------------------------------------------------------
-- ArtifactIndex
-- ----------------------------------------------------------------------------
CREATE TABLE artifact_index (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type            TEXT NOT NULL,
  -- Polymorphic reference to the historical artifact (article draft,
  -- evidence seal, etc.) in a module outside this checkpoint's scope -
  -- intentionally not a FK, same reasoning as client_review_decision.subject_id.
  artifact_id              UUID NOT NULL,
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  artifact_version         INTEGER NOT NULL,
  storage_path             TEXT NOT NULL,
  sealed_at                TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash             TEXT NOT NULL,

  CONSTRAINT ck_artifact_index_artifact_type_not_blank CHECK (length(trim(artifact_type)) > 0),
  CONSTRAINT ck_artifact_index_version_positive CHECK (artifact_version >= 1),
  CONSTRAINT uq_artifact_index_type_id_version UNIQUE (artifact_type, artifact_id, artifact_version)
);

CREATE INDEX ix_artifact_index_client_organization_id ON artifact_index(client_organization_id);
CREATE INDEX ix_artifact_index_project_id ON artifact_index(project_id);

-- Append-only per entities.ts: "Immutable index... Append-only:
-- SYSTEM_INVARIANTS_V1.md forbids modifying historical business artifacts."
-- Enforced at the database level (not just by application discipline): any
-- UPDATE or DELETE against this table raises an exception, so a bug or a
-- compromised app-tier credential cannot silently rewrite sealed history.
CREATE OR REPLACE FUNCTION artifact_index_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'artifact_index is append-only: % is not permitted (SYSTEM_INVARIANTS_V1.md)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_artifact_index_forbid_update
  BEFORE UPDATE ON artifact_index
  FOR EACH ROW EXECUTE FUNCTION artifact_index_forbid_mutation();

CREATE TRIGGER trg_artifact_index_forbid_delete
  BEFORE DELETE ON artifact_index
  FOR EACH ROW EXECUTE FUNCTION artifact_index_forbid_mutation();

COMMIT;
