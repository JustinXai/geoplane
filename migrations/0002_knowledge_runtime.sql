-- ============================================================================
-- Migration: 0002_knowledge_runtime
-- Checkpoint: KNOWLEDGE_SCHEMA_AND_PORTS_V1 (Agent D / runtime/knowledge-ingestion)
--
-- Scope: schema for the enterprise Knowledge Package chain (GEO business chain
--   step 1 - "Knowledge package / enterprise knowledge base ingestion", see
--   docs/architecture/GEO_BUSINESS_CHAIN_V1.md). Schema + constraints ONLY.
--   NO file parsing (that is KNOWLEDGE_FILE_INGESTION_V1, a later checkpoint) -
--   knowledge_version stores a storage reference + content hash, not extracted
--   text, at this checkpoint.
--
-- Alignment: the enum string values below are chosen to match the FROZEN
--   cross-lane API contract in src/runtime/api-contracts/index.ts
--   (KnowledgePackageStatusV1, KnowledgeIssueKindV1, KnowledgeIssueSeverityV1)
--   so a future API route can map these rows to the frozen view DTOs with no
--   value translation. This file does NOT import or alter that contract; it
--   only mirrors its literal values.
--
-- Tenancy: every table is tenant-scoped (client_organization_id NOT NULL, real
--   FK to organization) and, where a project owns the row, project-scoped
--   (project_id NOT NULL, real FK to project). This migration references ONLY
--   organization(id), project(id) and "user"(id) from 0001 by foreign key; it
--   does not alter any 0001 object.
--
-- Classification / public-scope / forbidden-usage / unverified-fact /
--   knowledge-gap: modelled as the knowledge_package.classification column
--   (public scope), the enterprise_profile.default_classification /
--   forbidden_usage columns, and the knowledge_issue.kind enum
--   (MISSING_INFORMATION = knowledge gap, UNVERIFIED_FACT, FORBIDDEN_USAGE,
--   CLASSIFICATION_NEEDED).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- knowledge_package
-- The channel-neutral enterprise knowledge base container for a project. A
-- package moves DRAFT -> IN_REVIEW -> CONFIRMED; confirmation is the human-
-- review gate (GEO_BUSINESS_CHAIN_V1 step 4) after which a snapshot can seal.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_package (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  title                    TEXT NOT NULL,
  -- DRAFT | IN_REVIEW | CONFIRMED  (KnowledgePackageStatusV1)
  status                   TEXT NOT NULL DEFAULT 'DRAFT',
  -- Public-scope / classification of the package as a whole. PUBLIC content is
  -- publishable; the stricter tiers gate downstream usage.
  classification           TEXT NOT NULL DEFAULT 'INTERNAL',
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at             TIMESTAMPTZ NULL,
  confirmed_by_user_id     UUID NULL REFERENCES "user"(id),

  CONSTRAINT ck_knowledge_package_status
    CHECK (status IN ('DRAFT', 'IN_REVIEW', 'CONFIRMED')),
  CONSTRAINT ck_knowledge_package_classification
    CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  CONSTRAINT ck_knowledge_package_title_not_blank
    CHECK (length(trim(title)) > 0),
  -- Confirmation stamps are set together, and only when CONFIRMED.
  CONSTRAINT ck_knowledge_package_confirmed_fields CHECK (
    (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL) OR
    (status <> 'CONFIRMED' AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL)
  )
);

CREATE INDEX ix_knowledge_package_client_org ON knowledge_package(client_organization_id);
CREATE INDEX ix_knowledge_package_project ON knowledge_package(project_id);

-- ----------------------------------------------------------------------------
-- knowledge_document
-- A single source item within a package (an uploaded file, a URL, a manually
-- entered note). Its editable content lives in append-only knowledge_version
-- rows; current_version_number mirrors the highest version added so far.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_document (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  package_id               UUID NOT NULL REFERENCES knowledge_package(id) ON DELETE CASCADE,
  title                    TEXT NOT NULL,
  -- Where this document came from. No parsing this checkpoint - the raw bytes
  -- are only referenced (storage_path on the version), never extracted here.
  source_kind              TEXT NOT NULL DEFAULT 'FILE',
  -- Highest version_number present in knowledge_version for this document.
  -- Maintained by the repository when a version is appended; 0 = no version yet.
  current_version_number   INTEGER NOT NULL DEFAULT 0,
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_knowledge_document_source_kind
    CHECK (source_kind IN ('FILE', 'URL', 'MANUAL', 'INTEGRATION')),
  CONSTRAINT ck_knowledge_document_title_not_blank
    CHECK (length(trim(title)) > 0),
  CONSTRAINT ck_knowledge_document_current_version_nonnegative
    CHECK (current_version_number >= 0),
  -- Two documents in the same package may not share a title.
  CONSTRAINT uq_knowledge_document_package_title UNIQUE (package_id, title)
);

CREATE INDEX ix_knowledge_document_client_org ON knowledge_document(client_organization_id);
CREATE INDEX ix_knowledge_document_project ON knowledge_document(project_id);
CREATE INDEX ix_knowledge_document_package ON knowledge_document(package_id);

-- ----------------------------------------------------------------------------
-- knowledge_version
-- Append-only-friendly, versioned content for a document. Each new revision is
-- a new row with the next version_number; existing rows are immutable (an
-- append-only-forbidding trigger on UPDATE below), so history cannot be
-- rewritten in place. version_number is unique per document.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_version (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  package_id               UUID NOT NULL REFERENCES knowledge_package(id) ON DELETE CASCADE,
  document_id              UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  version_number           INTEGER NOT NULL,
  -- Storage reference + integrity hash for the raw source bytes. Parsing /
  -- text extraction is deliberately out of scope this checkpoint.
  storage_path             TEXT NULL,
  content_hash             TEXT NOT NULL,
  byte_size                BIGINT NULL,
  mime_type                TEXT NULL,
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_knowledge_version_number_positive CHECK (version_number >= 1),
  CONSTRAINT ck_knowledge_version_byte_size_nonnegative
    CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT ck_knowledge_version_content_hash_not_blank
    CHECK (length(trim(content_hash)) > 0),
  -- The versioned append-only key: one row per (document, version_number).
  CONSTRAINT uq_knowledge_version_document_version UNIQUE (document_id, version_number)
);

CREATE INDEX ix_knowledge_version_client_org ON knowledge_version(client_organization_id);
CREATE INDEX ix_knowledge_version_project ON knowledge_version(project_id);
CREATE INDEX ix_knowledge_version_package ON knowledge_version(package_id);
CREATE INDEX ix_knowledge_version_document ON knowledge_version(document_id);

-- Append-only-friendly enforcement: an existing version row may not be edited
-- in place (that would rewrite recorded knowledge history). New revisions are
-- new rows. DELETE is intentionally NOT forbidden so that ON DELETE CASCADE
-- from a package/document teardown still works; only in-place UPDATE is barred.
CREATE OR REPLACE FUNCTION knowledge_version_forbid_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'knowledge_version is append-only: UPDATE is not permitted (add a new version row instead)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_version_forbid_update
  BEFORE UPDATE ON knowledge_version
  FOR EACH ROW EXECUTE FUNCTION knowledge_version_forbid_update();

-- ----------------------------------------------------------------------------
-- knowledge_issue
-- A quality finding against a package (optionally pinned to one document):
-- a knowledge gap (MISSING_INFORMATION), an UNVERIFIED_FACT, a FORBIDDEN_USAGE
-- flag, or a CLASSIFICATION_NEEDED prompt. Resolving an issue stamps who/when.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_issue (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  package_id               UUID NOT NULL REFERENCES knowledge_package(id) ON DELETE CASCADE,
  document_id              UUID NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  -- MISSING_INFORMATION | UNVERIFIED_FACT | FORBIDDEN_USAGE | CLASSIFICATION_NEEDED
  kind                     TEXT NOT NULL,
  -- INFO | WARNING | BLOCKER  (KnowledgeIssueSeverityV1)
  severity                 TEXT NOT NULL DEFAULT 'WARNING',
  message                  TEXT NOT NULL,
  resolved                 BOOLEAN NOT NULL DEFAULT false,
  resolved_at              TIMESTAMPTZ NULL,
  resolved_by_user_id      UUID NULL REFERENCES "user"(id),
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_knowledge_issue_kind
    CHECK (kind IN ('MISSING_INFORMATION', 'UNVERIFIED_FACT', 'FORBIDDEN_USAGE', 'CLASSIFICATION_NEEDED')),
  CONSTRAINT ck_knowledge_issue_severity
    CHECK (severity IN ('INFO', 'WARNING', 'BLOCKER')),
  CONSTRAINT ck_knowledge_issue_message_not_blank
    CHECK (length(trim(message)) > 0),
  -- Resolution stamps are set together, and only when resolved.
  CONSTRAINT ck_knowledge_issue_resolution_fields CHECK (
    (resolved = true AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL) OR
    (resolved = false AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
  )
);

CREATE INDEX ix_knowledge_issue_client_org ON knowledge_issue(client_organization_id);
CREATE INDEX ix_knowledge_issue_project ON knowledge_issue(project_id);
CREATE INDEX ix_knowledge_issue_package ON knowledge_issue(package_id);
CREATE INDEX ix_knowledge_issue_document ON knowledge_issue(document_id);
-- Fast lookup of the still-open issues that gate confirmation.
CREATE INDEX ix_knowledge_issue_open ON knowledge_issue(package_id) WHERE resolved = false;

-- ----------------------------------------------------------------------------
-- knowledge_snapshot
-- An immutable, sealed capture of a package at confirmation time (the
-- channel-neutral content package handed to the downstream keyword/opportunity
-- chain). snapshot_number is unique per package; at most one snapshot per
-- package may be the current (non-superseded) one.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_snapshot (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  package_id               UUID NOT NULL REFERENCES knowledge_package(id) ON DELETE CASCADE,
  snapshot_number          INTEGER NOT NULL,
  content_hash             TEXT NOT NULL,
  document_count           INTEGER NOT NULL DEFAULT 0,
  -- Classification captured at seal time (public-scope of the sealed package).
  classification           TEXT NOT NULL DEFAULT 'INTERNAL',
  -- NULL = current/active snapshot; set when a newer snapshot supersedes it.
  superseded_at            TIMESTAMPTZ NULL,
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_knowledge_snapshot_number_positive CHECK (snapshot_number >= 1),
  CONSTRAINT ck_knowledge_snapshot_document_count_nonnegative CHECK (document_count >= 0),
  CONSTRAINT ck_knowledge_snapshot_classification
    CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  CONSTRAINT ck_knowledge_snapshot_content_hash_not_blank
    CHECK (length(trim(content_hash)) > 0),
  CONSTRAINT uq_knowledge_snapshot_package_number UNIQUE (package_id, snapshot_number)
);

CREATE INDEX ix_knowledge_snapshot_client_org ON knowledge_snapshot(client_organization_id);
CREATE INDEX ix_knowledge_snapshot_project ON knowledge_snapshot(project_id);
CREATE INDEX ix_knowledge_snapshot_package ON knowledge_snapshot(package_id);

-- At most one current (non-superseded) snapshot per package.
CREATE UNIQUE INDEX uq_knowledge_snapshot_one_current_per_package
  ON knowledge_snapshot (package_id)
  WHERE superseded_at IS NULL;

-- Append-only-friendly: a sealed snapshot's captured fields are immutable; the
-- only permitted mutation is stamping superseded_at when a newer snapshot
-- takes over. A trigger rejects any UPDATE that touches another column.
CREATE OR REPLACE FUNCTION knowledge_snapshot_forbid_content_update() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_organization_id IS DISTINCT FROM OLD.client_organization_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.package_id IS DISTINCT FROM OLD.package_id
     OR NEW.snapshot_number IS DISTINCT FROM OLD.snapshot_number
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.document_count IS DISTINCT FROM OLD.document_count
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'knowledge_snapshot is sealed: only superseded_at may be updated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_snapshot_forbid_content_update
  BEFORE UPDATE ON knowledge_snapshot
  FOR EACH ROW EXECUTE FUNCTION knowledge_snapshot_forbid_content_update();

-- ----------------------------------------------------------------------------
-- enterprise_profile
-- The canonical, human-maintained identity of a CLIENT enterprise: legal name,
-- domain, industry, the default classification (public-scope) for its
-- knowledge, and a free-text forbidden-usage policy. Exactly one per client
-- organization (upsert target).
-- ----------------------------------------------------------------------------
CREATE TABLE enterprise_profile (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  legal_name               TEXT NOT NULL,
  display_name             TEXT NULL,
  primary_domain           TEXT NULL,
  industry                 TEXT NULL,
  description              TEXT NULL,
  -- Default public-scope for knowledge created under this enterprise.
  default_classification   TEXT NOT NULL DEFAULT 'INTERNAL',
  -- Free-text statement of usage the enterprise forbids (forbidden-usage).
  forbidden_usage          TEXT NULL,
  created_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id       UUID NOT NULL REFERENCES "user"(id),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_enterprise_profile_legal_name_not_blank
    CHECK (length(trim(legal_name)) > 0),
  CONSTRAINT ck_enterprise_profile_default_classification
    CHECK (default_classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  -- One profile per enterprise; the upsert conflict target.
  CONSTRAINT uq_enterprise_profile_client_org UNIQUE (client_organization_id)
);

COMMIT;
