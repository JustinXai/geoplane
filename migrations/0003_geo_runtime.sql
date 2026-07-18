-- ============================================================================
-- Migration: 0003_geo_runtime
-- Checkpoint: KEYWORD_OPPORTUNITY_RUNTIME_V1 (Agent E / runtime/geo-services)
--
-- Scope: real Postgres persistence for the FIRST business-chain slice of the
--   GEO runtime — keyword -> opportunity -> validation -> human-review — behind
--   the E1 consumer-defined ports in src/runtime/geo/ports.ts. Persists exactly
--   four aggregates (plus the keyword/question child rows of the first):
--
--     1. keyword_question_map (+ keyword_question_map_keyword
--                              + keyword_question_map_question child rows)
--     2. opportunity
--     3. opportunity_validation      (append-only history: version-and-append)
--     4. human_review_decision       (append-only history: version-and-append)
--
--   Article / gate / delivery persistence is a LATER checkpoint (E3), not here.
--
-- Alignment: the enum string values below are chosen to match the frozen offline
--   domain contract in src/contracts/geo-business/entities.ts
--   (OpportunityValidationStatus, HumanReviewDecisionStatus, GeoValidationGateLevel)
--   so a repository can map rows to those entities with no value translation.
--   This file does NOT import or alter that contract; it only mirrors its
--   literal values.
--
-- Tenancy: every table is tenant-scoped (client_organization_id NOT NULL, real
--   FK to organization) AND project-scoped (project_id NOT NULL, real FK to
--   project). This migration foreign-keys out to ONLY 0001's organization(id),
--   project(id) and "user"(id). It does not alter any 0001 or 0002 object.
--
-- Non-FK id references: knowledge_package_id / industry_profile_id (and the
--   grounding_* pair on opportunity) point at GEO-business aggregates whose own
--   tables are out of scope for this checkpoint (the geo-business KnowledgePackage
--   / IndustryProfile are distinct from D-lane 0002's knowledge_package). They
--   are therefore plain UUID columns, NOT foreign keys — the same deliberate
--   "polymorphic reference to an out-of-scope module" pattern 0001 uses for
--   client_review_decision.subject_id and artifact_index.artifact_id.
--
-- Append-only history (docs/governance/SYSTEM_INVARIANTS_V1.md, "historical
--   artifacts are never mutated"): opportunity_validation and
--   human_review_decision are version-and-append — a revised outcome is a NEW
--   row, never an in-place edit. UPDATE and DELETE are forbidden at the database
--   level by triggers (same pattern as 0001's trg_artifact_index_forbid_*), so
--   recorded history cannot be rewritten even by a compromised app credential.
--
-- No-silent-approval (docs/governance/SYSTEM_INVARIANTS_V1.md): a silently-
--   approved human-review state is made UNREPRESENTABLE — see the block on
--   human_review_decision below (decision has NO default; an APPROVED row
--   structurally requires an explicit reviewer_user_id + decided_at).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- keyword_question_map
-- The keyword <-> real-user-question mapping (geo-business KeywordQuestionMap),
-- derived from a specific KnowledgePackage (pinned by id + version so provenance
-- survives the source later being sealed/superseded) and validated against an
-- IndustryProfile. The mapping's entries live in the two child tables below.
-- ----------------------------------------------------------------------------
CREATE TABLE keyword_question_map (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id      UUID NOT NULL REFERENCES organization(id),
  project_id                  UUID NOT NULL REFERENCES project(id),
  -- Not a FK: the geo-business KnowledgePackage aggregate is not persisted at
  -- this checkpoint (see file header, "Non-FK id references").
  knowledge_package_id        UUID NOT NULL,
  knowledge_package_version   INTEGER NOT NULL,
  -- Not a FK: the geo-business IndustryProfile aggregate is not persisted here.
  industry_profile_id         UUID NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_keyword_question_map_kp_version_positive
    CHECK (knowledge_package_version >= 1)
);

CREATE INDEX ix_keyword_question_map_client_org ON keyword_question_map(client_organization_id);
CREATE INDEX ix_keyword_question_map_project ON keyword_question_map(project_id);

-- ----------------------------------------------------------------------------
-- keyword_question_map_keyword
-- One keyword within a map's entries. Ordered by position for stable read-back.
-- A map may not carry the same keyword twice.
-- ----------------------------------------------------------------------------
CREATE TABLE keyword_question_map_keyword (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  keyword_question_map_id  UUID NOT NULL REFERENCES keyword_question_map(id) ON DELETE CASCADE,
  keyword                  TEXT NOT NULL,
  -- 0-based position within the map's entries, for deterministic ordering.
  position                 INTEGER NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_kqm_keyword_not_blank CHECK (length(trim(keyword)) > 0),
  CONSTRAINT ck_kqm_keyword_position_nonnegative CHECK (position >= 0),
  CONSTRAINT uq_kqm_keyword_per_map UNIQUE (keyword_question_map_id, keyword),
  CONSTRAINT uq_kqm_keyword_position UNIQUE (keyword_question_map_id, position)
);

CREATE INDEX ix_kqm_keyword_client_org ON keyword_question_map_keyword(client_organization_id);
CREATE INDEX ix_kqm_keyword_project ON keyword_question_map_keyword(project_id);
CREATE INDEX ix_kqm_keyword_map ON keyword_question_map_keyword(keyword_question_map_id);

-- ----------------------------------------------------------------------------
-- keyword_question_map_question
-- One real user question mapped to a keyword. The "questions must be non-empty"
-- rule from the entity (a keyword paired with the actual questions users ask)
-- is enforced by the repository (it refuses to persist an entry with zero
-- questions); at the DB level each question row is guaranteed non-blank.
-- ----------------------------------------------------------------------------
CREATE TABLE keyword_question_map_question (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id      UUID NOT NULL REFERENCES organization(id),
  project_id                  UUID NOT NULL REFERENCES project(id),
  keyword_question_map_id     UUID NOT NULL REFERENCES keyword_question_map(id) ON DELETE CASCADE,
  keyword_id                  UUID NOT NULL REFERENCES keyword_question_map_keyword(id) ON DELETE CASCADE,
  question                    TEXT NOT NULL,
  -- 0-based position within the keyword's question list, for deterministic ordering.
  position                    INTEGER NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_kqm_question_not_blank CHECK (length(trim(question)) > 0),
  CONSTRAINT ck_kqm_question_position_nonnegative CHECK (position >= 0),
  CONSTRAINT uq_kqm_question_position UNIQUE (keyword_id, position)
);

CREATE INDEX ix_kqm_question_client_org ON keyword_question_map_question(client_organization_id);
CREATE INDEX ix_kqm_question_project ON keyword_question_map_question(project_id);
CREATE INDEX ix_kqm_question_map ON keyword_question_map_question(keyword_question_map_id);
CREATE INDEX ix_kqm_question_keyword ON keyword_question_map_question(keyword_id);

-- ----------------------------------------------------------------------------
-- opportunity
-- A candidate content opportunity derived from one keyword within a
-- KeywordQuestionMap entry. Grounding is non-optional: an opportunity always
-- traces back to the KnowledgePackage id + version it was grounded in.
-- ----------------------------------------------------------------------------
CREATE TABLE opportunity (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id              UUID NOT NULL REFERENCES organization(id),
  project_id                          UUID NOT NULL REFERENCES project(id),
  keyword_question_map_id             UUID NOT NULL REFERENCES keyword_question_map(id),
  keyword                             TEXT NOT NULL,
  -- Not a FK: geo-business KnowledgePackage is not persisted at this checkpoint.
  grounding_knowledge_package_id      UUID NOT NULL,
  grounding_knowledge_package_version INTEGER NOT NULL,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_opportunity_keyword_not_blank CHECK (length(trim(keyword)) > 0),
  CONSTRAINT ck_opportunity_grounding_version_positive
    CHECK (grounding_knowledge_package_version >= 1)
);

CREATE INDEX ix_opportunity_client_org ON opportunity(client_organization_id);
CREATE INDEX ix_opportunity_project ON opportunity(project_id);
CREATE INDEX ix_opportunity_map ON opportunity(keyword_question_map_id);

-- ----------------------------------------------------------------------------
-- opportunity_validation  (APPEND-ONLY history)
-- The outcome of validating an Opportunity against an IndustryProfile. A
-- re-validation is a NEW row; existing rows are immutable (trigger below).
-- gate_level_applied is a point-in-time capture of the gate level actually
-- applied, kept for auditability even if the profile's level later changes.
-- ----------------------------------------------------------------------------
CREATE TABLE opportunity_validation (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  opportunity_id           UUID NOT NULL REFERENCES opportunity(id),
  -- PENDING_VALIDATION | VALIDATED | REJECTED  (OpportunityValidationStatus)
  status                   TEXT NOT NULL,
  -- Not a FK: geo-business IndustryProfile is not persisted at this checkpoint.
  industry_profile_id      UUID NOT NULL,
  -- PLATFORM_WIDE_GATE | INDUSTRY_VERTICAL_GATE  (GeoValidationGateLevel)
  gate_level_applied       TEXT NOT NULL,
  reason_note              TEXT NOT NULL,
  validated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_opportunity_validation_status
    CHECK (status IN ('PENDING_VALIDATION', 'VALIDATED', 'REJECTED')),
  CONSTRAINT ck_opportunity_validation_gate_level
    CHECK (gate_level_applied IN ('PLATFORM_WIDE_GATE', 'INDUSTRY_VERTICAL_GATE'))
);

CREATE INDEX ix_opportunity_validation_client_org ON opportunity_validation(client_organization_id);
CREATE INDEX ix_opportunity_validation_project ON opportunity_validation(project_id);
CREATE INDEX ix_opportunity_validation_opportunity ON opportunity_validation(opportunity_id);

-- Append-only: a recorded validation outcome is history and may never be edited
-- in place or deleted. A re-validation is a new row. Same DB-level guarantee as
-- 0001's artifact_index (not merely an application convention).
CREATE OR REPLACE FUNCTION opportunity_validation_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'opportunity_validation is append-only: % is not permitted (add a new validation row instead)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_opportunity_validation_forbid_update
  BEFORE UPDATE ON opportunity_validation
  FOR EACH ROW EXECUTE FUNCTION opportunity_validation_forbid_mutation();

CREATE TRIGGER trg_opportunity_validation_forbid_delete
  BEFORE DELETE ON opportunity_validation
  FOR EACH ROW EXECUTE FUNCTION opportunity_validation_forbid_mutation();

-- ----------------------------------------------------------------------------
-- human_review_decision  (APPEND-ONLY history; NO SILENT APPROVAL)
-- The human-review gate outcome for an Opportunity, acting on a specific
-- OpportunityValidation. Models the frozen HumanReviewDecision discriminated
-- union (APPROVED / CHANGES_REQUESTED / REJECTED).
--
-- A silently-approved state is UNREPRESENTABLE, enforced three ways:
--
--   1. `decision` has NO DEFAULT. An INSERT that omits it fails the NOT NULL
--      constraint rather than silently defaulting to an approval — there is no
--      "approved unless stated otherwise" path.
--   2. `reviewer_user_id` and `decided_at` are NOT NULL with NO DEFAULT (no
--      auto-now()), so every decision — approval included — must carry a real,
--      explicitly-supplied reviewer identity and decision timestamp. This
--      mirrors the entity, where reviewerId + decidedAt are non-optional on
--      every variant of the union.
--   3. An explicit CHECK (ck_human_review_no_silent_approve) states the
--      invariant directly: an APPROVED row REQUIRES reviewer_user_id IS NOT NULL
--      AND decided_at IS NOT NULL. It is deliberately kept even though (2)
--      already guarantees it — it is the load-bearing, self-documenting
--      encoding of "an approval can never exist without a named reviewer", and
--      it remains a real barrier if a future migration ever relaxed the columns
--      to nullable.
--
-- The per-variant note columns encode the union's variant-specific required
-- fields: CHANGES_REQUESTED requires requested_changes_note; REJECTED requires
-- rejection_reason_note; APPROVED carries neither.
-- ----------------------------------------------------------------------------
CREATE TABLE human_review_decision (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  opportunity_id           UUID NOT NULL REFERENCES opportunity(id),
  opportunity_validation_id UUID NOT NULL REFERENCES opportunity_validation(id),
  -- APPROVED | CHANGES_REQUESTED | REJECTED  (HumanReviewDecisionStatus).
  -- Deliberately NO DEFAULT: an approval can never arise by omission.
  decision                 TEXT NOT NULL,
  -- Required for EVERY decision (mirrors the entity's non-optional reviewerId /
  -- decidedAt on all three variants). No DEFAULT on decided_at — it must be
  -- supplied explicitly, never auto-stamped.
  reviewer_user_id         UUID NOT NULL REFERENCES "user"(id),
  decided_at               TIMESTAMPTZ NOT NULL,
  requested_changes_note   TEXT NULL,
  rejection_reason_note    TEXT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_human_review_decision_value
    CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  -- (3) above: an APPROVED row is unrepresentable without an explicit reviewer
  -- identity and decision timestamp.
  CONSTRAINT ck_human_review_no_silent_approve CHECK (
    decision <> 'APPROVED' OR (reviewer_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- Variant-specific required fields of the discriminated union.
  CONSTRAINT ck_human_review_variant_notes CHECK (
    (decision = 'APPROVED'
       AND requested_changes_note IS NULL
       AND rejection_reason_note IS NULL)
    OR
    (decision = 'CHANGES_REQUESTED'
       AND requested_changes_note IS NOT NULL AND length(trim(requested_changes_note)) > 0
       AND rejection_reason_note IS NULL)
    OR
    (decision = 'REJECTED'
       AND rejection_reason_note IS NOT NULL AND length(trim(rejection_reason_note)) > 0
       AND requested_changes_note IS NULL)
  )
);

CREATE INDEX ix_human_review_decision_client_org ON human_review_decision(client_organization_id);
CREATE INDEX ix_human_review_decision_project ON human_review_decision(project_id);
CREATE INDEX ix_human_review_decision_opportunity ON human_review_decision(opportunity_id);
CREATE INDEX ix_human_review_decision_validation ON human_review_decision(opportunity_validation_id);

-- Append-only: a recorded review decision is history and may never be edited in
-- place or deleted. A revised decision is a new row.
CREATE OR REPLACE FUNCTION human_review_decision_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'human_review_decision is append-only: % is not permitted (add a new decision row instead)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_human_review_decision_forbid_update
  BEFORE UPDATE ON human_review_decision
  FOR EACH ROW EXECUTE FUNCTION human_review_decision_forbid_mutation();

CREATE TRIGGER trg_human_review_decision_forbid_delete
  BEFORE DELETE ON human_review_decision
  FOR EACH ROW EXECUTE FUNCTION human_review_decision_forbid_mutation();

COMMIT;
