-- ============================================================================
-- Migration: 0004_geo_article_delivery
-- Checkpoint: ARTICLE_GATE_DELIVERY_RUNTIME_V1 (Agent E3 / runtime/geo-services)
--
-- Scope: real Postgres persistence for the REMAINDER of the GEO business chain
--   (the article -> gates -> approval -> publish -> distribution -> delivery
--   slice), behind the E1 consumer-defined ports in src/runtime/geo/ports.ts.
--   0003 persisted keyword -> opportunity -> validation -> human-review; this
--   migration continues from there and persists:
--
--     opportunity_family (+ opportunity_family_member child rows)
--     article_brief
--     article_draft                     (VERSIONED, append-only: one row/version)
--     quality_gate_result
--     platform_gate_result
--     vertical_gate_result
--     article_approval                  (append-only; NO silent approval)
--     publish_package
--     channel_neutral_content_package   (+ channel_neutral_content_block child)
--     distribution_plan                 (holds the auditable channel set)
--     publication_receipt               (append-only; NO automatic publication)
--     delivery                          (append-only; client-readable projection)
--
-- Alignment: enum/literal string values below mirror the frozen offline domain
--   contract in src/contracts/geo-business/entities.ts (GateOutcomeStatus,
--   GeoValidationGateLevel, ChannelNeutralContentBlock.kind, the "APPROVED"
--   family-member status literal, and the DRAFT/SEALED ArticleDraft variants)
--   so a repository maps rows to those entities with no value translation. This
--   file does NOT import or alter that contract; it only mirrors its literals.
--
-- Tenancy: every table is tenant-scoped (client_organization_id NOT NULL, real
--   FK to organization) AND project-scoped (project_id NOT NULL, real FK to
--   project). Real foreign keys point out ONLY to 0001's organization(id),
--   project(id) and "user"(id). Within this migration, 0004 tables FK to each
--   other (e.g. member -> family, block -> package, delivery -> receipt).
--
-- Non-FK id references (polymorphic UUIDs): references to aggregates that live
--   in OTHER migrations (0003's opportunity / human_review_decision, and the
--   geo-business IndustryProfile which is not persisted at all) are plain UUID
--   columns, NOT foreign keys — the same deliberate "polymorphic reference to an
--   out-of-scope module" pattern 0001 uses for client_review_decision.subject_id
--   and 0003 uses for opportunity.grounding_knowledge_package_id.
--
-- Append-only history (docs/governance/SYSTEM_INVARIANTS_V1.md, "historical
--   artifacts are never mutated"): article_draft, article_approval,
--   publication_receipt and delivery are append-only — a revised artifact is a
--   NEW row, never an in-place edit. UPDATE and DELETE are forbidden at the
--   database level by triggers (same pattern as 0001's artifact_index and 0003's
--   opportunity_validation), so recorded history cannot be rewritten even by a
--   compromised app credential.
--
-- DB-enforced business invariants (all load-bearing, not app conventions):
--   * NO SILENT APPROVAL — article_approval.decision cannot arise by omission:
--     there is no default; approver_user_id (a real "user" FK) and approved_at
--     are NOT NULL with no default now(); an explicit CHECK restates it; and all
--     three gate-status columns are pinned to the literal 'PASSED'. An approval
--     is unrepresentable without a named approver, an explicit timestamp, and
--     three passed gates.
--   * NO AUTOMATIC PUBLICATION — publication_receipt.published_by_actor_id is
--     NOT NULL and a CHECK forbids the automatic/system sentinels
--     ('system'/'auto'/'automated'/'automatic') and blank, mirroring the frozen
--     FORBIDDEN_AUTOMATIC_ACTOR_IDS set in entities.ts.
--   * 0 DEFAULT CHANNELS — channel_neutral_content_package.target_channel_ids
--     DEFAULTs to the empty array '{}': a package is born with zero selected
--     channels and can never be created pre-seeded with one.
--   * NON-EMPTY DISTRIBUTION — distribution_plan.channel_ids CHECK requires at
--     least one channel, plus a NOT NULL human selected_by_actor_id + selected_at
--     ("ready to distribute with zero explicit human action" is unrepresentable).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- opportunity_family
-- Groups one or more APPROVED Opportunities into the unit that becomes a single
-- piece of content (geo-business OpportunityFamily). "One or more" is enforced
-- by the repository (it refuses to persist a family with zero members); each
-- member row additionally proves its authorizing decision was APPROVED.
-- ----------------------------------------------------------------------------
CREATE TABLE opportunity_family (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_opportunity_family_client_org ON opportunity_family(client_organization_id);
CREATE INDEX ix_opportunity_family_project ON opportunity_family(project_id);

-- ----------------------------------------------------------------------------
-- opportunity_family_member
-- One Opportunity's membership in a family. The authorizing HumanReviewDecision
-- status is pinned to 'APPROVED' at the DB level (ck_ofm_status_approved),
-- making "no Opportunity may enter a family without an APPROVED decision" a
-- structural database rule, not merely an application check. opportunity_id and
-- authorizing_human_review_decision_id are polymorphic UUIDs (0003 aggregates),
-- not FKs — see the file header.
-- ----------------------------------------------------------------------------
CREATE TABLE opportunity_family_member (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id               UUID NOT NULL REFERENCES organization(id),
  project_id                           UUID NOT NULL REFERENCES project(id),
  opportunity_family_id                UUID NOT NULL REFERENCES opportunity_family(id) ON DELETE CASCADE,
  opportunity_id                       UUID NOT NULL,
  authorizing_human_review_decision_id UUID NOT NULL,
  authorizing_review_decision_status   TEXT NOT NULL,
  -- 0-based position within the family's members, for deterministic ordering.
  position                             INTEGER NOT NULL,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_ofm_status_approved CHECK (authorizing_review_decision_status = 'APPROVED'),
  CONSTRAINT ck_ofm_position_nonnegative CHECK (position >= 0),
  CONSTRAINT uq_ofm_position UNIQUE (opportunity_family_id, position),
  CONSTRAINT uq_ofm_opportunity UNIQUE (opportunity_family_id, opportunity_id)
);

CREATE INDEX ix_ofm_client_org ON opportunity_family_member(client_organization_id);
CREATE INDEX ix_ofm_project ON opportunity_family_member(project_id);
CREATE INDEX ix_ofm_family ON opportunity_family_member(opportunity_family_id);

-- ----------------------------------------------------------------------------
-- article_brief
-- The planning brief built from an OpportunityFamily. Flat scalar lists
-- (outline, planning targetKeywords, planning authorizingHumanReviewDecisionIds)
-- are stored as array columns preserving order. The required non-empty lists
-- (targetKeywords, authorizingHumanReviewDecisionIds — non-empty tuples in the
-- frozen ArticleBriefPlanningContextV1) are guarded by CHECKs; outline may be
-- empty (a plain string[] in the contract).
-- ----------------------------------------------------------------------------
CREATE TABLE article_brief (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id          UUID NOT NULL REFERENCES organization(id),
  project_id                      UUID NOT NULL REFERENCES project(id),
  opportunity_family_id           UUID NOT NULL REFERENCES opportunity_family(id),
  working_title                   TEXT NOT NULL,
  outline                         TEXT[] NOT NULL DEFAULT '{}',
  -- ArticleBriefPlanningContextV1 fields (inlined; schemaVersion is a fixed literal).
  planning_schema_version         TEXT NOT NULL,
  planning_opportunity_family_id  UUID NOT NULL,
  planning_risk_level             TEXT NOT NULL,
  planning_target_keywords        TEXT[] NOT NULL,
  planning_authorizing_hrd_ids    UUID[] NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_article_brief_schema_version
    CHECK (planning_schema_version = 'ArticleBriefPlanningContextV1'),
  CONSTRAINT ck_article_brief_risk_level
    CHECK (planning_risk_level IN ('STANDARD', 'ESCALATED_FOR_HUMAN_REVIEW')),
  CONSTRAINT ck_article_brief_target_keywords_nonempty
    CHECK (array_length(planning_target_keywords, 1) >= 1),
  CONSTRAINT ck_article_brief_authorizing_hrd_nonempty
    CHECK (array_length(planning_authorizing_hrd_ids, 1) >= 1)
);

CREATE INDEX ix_article_brief_client_org ON article_brief(client_organization_id);
CREATE INDEX ix_article_brief_project ON article_brief(project_id);
CREATE INDEX ix_article_brief_family ON article_brief(opportunity_family_id);

-- ----------------------------------------------------------------------------
-- article_draft  (VERSIONED, APPEND-ONLY)
-- The compiled, user-visible draft. Versioning is version-and-append: each
-- compile is a NEW row with a new id and an incremented `version`, monotonic per
-- (client_organization_id, project_id, article_brief_id). A prior version is
-- never mutated (trigger below); the UNIQUE (brief, version) prevents two rows
-- claiming the same version. status mirrors the frozen DRAFT/SEALED union:
-- sealed_at is present only on a SEALED row.
--
-- sections are stored as an ordered TEXT[] of section headings (each section is
-- {heading, order} with order = array index, exactly as compileArticleDraft
-- builds them). source_provider_article_content_ids is a non-empty UUID[]
-- (a non-empty tuple in the contract).
-- ----------------------------------------------------------------------------
CREATE TABLE article_draft (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id               UUID NOT NULL REFERENCES organization(id),
  project_id                           UUID NOT NULL REFERENCES project(id),
  article_brief_id                     UUID NOT NULL REFERENCES article_brief(id),
  version                              INTEGER NOT NULL,
  title                                TEXT NOT NULL,
  section_headings                     TEXT[] NOT NULL DEFAULT '{}',
  source_provider_article_content_ids  UUID[] NOT NULL,
  status                               TEXT NOT NULL,
  sealed_at                            TIMESTAMPTZ NULL,
  compiled_at                          TIMESTAMPTZ NOT NULL,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_article_draft_version_positive CHECK (version >= 1),
  CONSTRAINT ck_article_draft_source_content_nonempty
    CHECK (array_length(source_provider_article_content_ids, 1) >= 1),
  CONSTRAINT ck_article_draft_status CHECK (status IN ('DRAFT', 'SEALED')),
  -- sealed_at exists iff the draft is SEALED (mirrors the discriminated union).
  CONSTRAINT ck_article_draft_sealed_at CHECK (
    (status = 'SEALED' AND sealed_at IS NOT NULL)
    OR (status = 'DRAFT' AND sealed_at IS NULL)
  ),
  CONSTRAINT uq_article_draft_brief_version UNIQUE (article_brief_id, version)
);

CREATE INDEX ix_article_draft_client_org ON article_draft(client_organization_id);
CREATE INDEX ix_article_draft_project ON article_draft(project_id);
CREATE INDEX ix_article_draft_brief ON article_draft(article_brief_id);

CREATE OR REPLACE FUNCTION article_draft_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'article_draft is append-only: % is not permitted (compile a new draft version instead)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_article_draft_forbid_update
  BEFORE UPDATE ON article_draft
  FOR EACH ROW EXECUTE FUNCTION article_draft_forbid_mutation();

CREATE TRIGGER trg_article_draft_forbid_delete
  BEFORE DELETE ON article_draft
  FOR EACH ROW EXECUTE FUNCTION article_draft_forbid_mutation();

-- ----------------------------------------------------------------------------
-- quality_gate_result / platform_gate_result / vertical_gate_result
-- The pass/fail OUTCOME of running an ArticleDraft through a gate. None is a
-- bare boolean: status is PASSED | FAILED, and a FAILED row REQUIRES a non-empty
-- failure_reasons array (a failure can never be silent/reasonless); a PASSED row
-- carries none. article_draft_id is a polymorphic UUID (kept append-only-safe:
-- gates reference the draft but are their own aggregate). platform/vertical also
-- capture the point-in-time gate level applied, like 0003's
-- opportunity_validation.gate_level_applied.
-- ----------------------------------------------------------------------------
CREATE TABLE quality_gate_result (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  article_draft_id         UUID NOT NULL,
  status                   TEXT NOT NULL,
  failure_reasons          TEXT[] NOT NULL DEFAULT '{}',
  evaluated_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_quality_gate_status CHECK (status IN ('PASSED', 'FAILED')),
  CONSTRAINT ck_quality_gate_failure_reasons CHECK (
    (status = 'FAILED' AND array_length(failure_reasons, 1) >= 1)
    OR (status = 'PASSED' AND (failure_reasons = '{}'))
  )
);

CREATE INDEX ix_quality_gate_client_org ON quality_gate_result(client_organization_id);
CREATE INDEX ix_quality_gate_project ON quality_gate_result(project_id);
CREATE INDEX ix_quality_gate_draft ON quality_gate_result(article_draft_id);

CREATE TABLE platform_gate_result (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  article_draft_id         UUID NOT NULL,
  -- Discriminant so platform/vertical rows are never structurally interchangeable.
  gate_kind                TEXT NOT NULL,
  industry_profile_id      UUID NOT NULL,
  gate_level_applied       TEXT NOT NULL,
  status                   TEXT NOT NULL,
  failure_reasons          TEXT[] NOT NULL DEFAULT '{}',
  evaluated_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_platform_gate_kind CHECK (gate_kind = 'PLATFORM_GATE'),
  CONSTRAINT ck_platform_gate_level
    CHECK (gate_level_applied IN ('PLATFORM_WIDE_GATE', 'INDUSTRY_VERTICAL_GATE')),
  CONSTRAINT ck_platform_gate_status CHECK (status IN ('PASSED', 'FAILED')),
  CONSTRAINT ck_platform_gate_failure_reasons CHECK (
    (status = 'FAILED' AND array_length(failure_reasons, 1) >= 1)
    OR (status = 'PASSED' AND (failure_reasons = '{}'))
  )
);

CREATE INDEX ix_platform_gate_client_org ON platform_gate_result(client_organization_id);
CREATE INDEX ix_platform_gate_project ON platform_gate_result(project_id);
CREATE INDEX ix_platform_gate_draft ON platform_gate_result(article_draft_id);

CREATE TABLE vertical_gate_result (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  article_draft_id         UUID NOT NULL,
  gate_kind                TEXT NOT NULL,
  industry_profile_id      UUID NOT NULL,
  gate_level_applied       TEXT NOT NULL,
  status                   TEXT NOT NULL,
  failure_reasons          TEXT[] NOT NULL DEFAULT '{}',
  evaluated_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_vertical_gate_kind CHECK (gate_kind = 'VERTICAL_GATE'),
  CONSTRAINT ck_vertical_gate_level
    CHECK (gate_level_applied IN ('PLATFORM_WIDE_GATE', 'INDUSTRY_VERTICAL_GATE')),
  CONSTRAINT ck_vertical_gate_status CHECK (status IN ('PASSED', 'FAILED')),
  CONSTRAINT ck_vertical_gate_failure_reasons CHECK (
    (status = 'FAILED' AND array_length(failure_reasons, 1) >= 1)
    OR (status = 'PASSED' AND (failure_reasons = '{}'))
  )
);

CREATE INDEX ix_vertical_gate_client_org ON vertical_gate_result(client_organization_id);
CREATE INDEX ix_vertical_gate_project ON vertical_gate_result(project_id);
CREATE INDEX ix_vertical_gate_draft ON vertical_gate_result(article_draft_id);

-- ----------------------------------------------------------------------------
-- article_approval  (APPEND-ONLY; NO SILENT APPROVAL)
-- The final human approval of an ArticleDraft for publication. A silently-
-- approved state is UNREPRESENTABLE, enforced several ways:
--
--   1. approver_user_id is NOT NULL and a real FK to "user" — an approval can
--      never exist without a named, real approver identity. There is no default.
--   2. approved_at is NOT NULL with NO default now() — the decision timestamp
--      must be supplied explicitly, never auto-stamped into existence.
--   3. An explicit CHECK (ck_article_approval_no_silent_approve) restates the
--      invariant directly (kept even though (1)/(2) already guarantee it — it is
--      the self-documenting barrier if a future migration relaxed the columns).
--   4. All three gate-status columns are pinned to the literal 'PASSED': an
--      approval structurally cannot reference a failed/missing gate.
--
-- Gate references are FKs to this migration's gate-result tables (so an approval
-- cannot cite a gate that does not exist); article_draft_id FKs to article_draft.
-- ----------------------------------------------------------------------------
CREATE TABLE article_approval (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  article_draft_id         UUID NOT NULL REFERENCES article_draft(id),
  -- Required for every approval (no default): a real approver identity + timestamp.
  approver_user_id         UUID NOT NULL REFERENCES "user"(id),
  approved_at              TIMESTAMPTZ NOT NULL,
  quality_gate_id          UUID NOT NULL REFERENCES quality_gate_result(id),
  quality_gate_status      TEXT NOT NULL,
  platform_gate_id         UUID NOT NULL REFERENCES platform_gate_result(id),
  platform_gate_status     TEXT NOT NULL,
  vertical_gate_id         UUID NOT NULL REFERENCES vertical_gate_result(id),
  vertical_gate_status     TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- (3): an approval is unrepresentable without an explicit approver + timestamp.
  CONSTRAINT ck_article_approval_no_silent_approve CHECK (
    approver_user_id IS NOT NULL AND approved_at IS NOT NULL
  ),
  -- (4): every gate this approval is built on must be PASSED.
  CONSTRAINT ck_article_approval_quality_passed CHECK (quality_gate_status = 'PASSED'),
  CONSTRAINT ck_article_approval_platform_passed CHECK (platform_gate_status = 'PASSED'),
  CONSTRAINT ck_article_approval_vertical_passed CHECK (vertical_gate_status = 'PASSED')
);

CREATE INDEX ix_article_approval_client_org ON article_approval(client_organization_id);
CREATE INDEX ix_article_approval_project ON article_approval(project_id);
CREATE INDEX ix_article_approval_draft ON article_approval(article_draft_id);

CREATE OR REPLACE FUNCTION article_approval_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'article_approval is append-only: % is not permitted (a revised approval is a new row)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_article_approval_forbid_update
  BEFORE UPDATE ON article_approval
  FOR EACH ROW EXECUTE FUNCTION article_approval_forbid_mutation();

CREATE TRIGGER trg_article_approval_forbid_delete
  BEFORE DELETE ON article_approval
  FOR EACH ROW EXECUTE FUNCTION article_approval_forbid_mutation();

-- ----------------------------------------------------------------------------
-- publish_package
-- The publication-ready package built from an ArticleApproval. article_approval_id
-- is NOT NULL and a real FK — nothing may be packaged for publication without a
-- real approval (the "nothing publishes without approval" invariant). article_
-- draft_id is carried forward for traceability (polymorphic-safe FK to draft).
-- ----------------------------------------------------------------------------
CREATE TABLE publish_package (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  article_approval_id      UUID NOT NULL REFERENCES article_approval(id),
  article_draft_id         UUID NOT NULL REFERENCES article_draft(id),
  title                    TEXT NOT NULL,
  built_at                 TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_publish_package_client_org ON publish_package(client_organization_id);
CREATE INDEX ix_publish_package_project ON publish_package(project_id);
CREATE INDEX ix_publish_package_approval ON publish_package(article_approval_id);

-- ----------------------------------------------------------------------------
-- channel_neutral_content_package  (0 DEFAULT CHANNELS)
-- Channel-agnostic, publication-ready content built from a PublishPackage.
-- target_channel_ids DEFAULTs to the empty array '{}' — a package is born with
-- ZERO selected channels and there is no way to create it pre-seeded with one
-- (the "platform-neutral by default / 0 selected channels" invariant). Adding a
-- channel is a separate, explicit, auditable act recorded in distribution_plan,
-- never a default here.
-- ----------------------------------------------------------------------------
CREATE TABLE channel_neutral_content_package (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  publish_package_id       UUID NOT NULL REFERENCES publish_package(id),
  -- Zero by default: no default channel is ever auto-selected.
  target_channel_ids       TEXT[] NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_cnc_package_client_org ON channel_neutral_content_package(client_organization_id);
CREATE INDEX ix_cnc_package_project ON channel_neutral_content_package(project_id);
CREATE INDEX ix_cnc_package_publish ON channel_neutral_content_package(publish_package_id);

-- ----------------------------------------------------------------------------
-- channel_neutral_content_block
-- One structural, channel-agnostic content unit of a package, ordered by
-- position. `kind` is restricted to the frozen ChannelNeutralContentBlock.kind
-- domain; there is deliberately no platform-specific markup column.
-- ----------------------------------------------------------------------------
CREATE TABLE channel_neutral_content_block (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id               UUID NOT NULL REFERENCES organization(id),
  project_id                           UUID NOT NULL REFERENCES project(id),
  channel_neutral_content_package_id   UUID NOT NULL REFERENCES channel_neutral_content_package(id) ON DELETE CASCADE,
  kind                                 TEXT NOT NULL,
  text                                 TEXT NOT NULL,
  -- 0-based position within the package's blocks, for deterministic ordering.
  position                             INTEGER NOT NULL,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_cnc_block_kind
    CHECK (kind IN ('HEADING', 'PARAGRAPH', 'LIST', 'IMAGE_REFERENCE')),
  CONSTRAINT ck_cnc_block_position_nonnegative CHECK (position >= 0),
  CONSTRAINT uq_cnc_block_position UNIQUE (channel_neutral_content_package_id, position)
);

CREATE INDEX ix_cnc_block_client_org ON channel_neutral_content_block(client_organization_id);
CREATE INDEX ix_cnc_block_project ON channel_neutral_content_block(project_id);
CREATE INDEX ix_cnc_block_package ON channel_neutral_content_block(channel_neutral_content_package_id);

-- ----------------------------------------------------------------------------
-- distribution_plan  (HOLDS THE AUDITABLE CHANNEL SET)
-- References a ChannelNeutralContentPackage plus the explicit, human-chosen set
-- of channels to distribute it to. channel_ids is CHECK'd non-empty ("ready to
-- distribute" with zero channels is unrepresentable), and selected_by_actor_id +
-- selected_at are NOT NULL — a plan always records which human explicitly chose
-- the channels and when. There is no automatic default channel.
-- ----------------------------------------------------------------------------
CREATE TABLE distribution_plan (
  id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id               UUID NOT NULL REFERENCES organization(id),
  project_id                           UUID NOT NULL REFERENCES project(id),
  channel_neutral_content_package_id   UUID NOT NULL REFERENCES channel_neutral_content_package(id),
  channel_ids                          TEXT[] NOT NULL,
  selected_by_actor_id                 TEXT NOT NULL,
  selected_at                          TIMESTAMPTZ NOT NULL,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_distribution_plan_channels_nonempty
    CHECK (array_length(channel_ids, 1) >= 1),
  CONSTRAINT ck_distribution_plan_actor_not_blank
    CHECK (length(trim(selected_by_actor_id)) > 0)
);

CREATE INDEX ix_distribution_plan_client_org ON distribution_plan(client_organization_id);
CREATE INDEX ix_distribution_plan_project ON distribution_plan(project_id);
CREATE INDEX ix_distribution_plan_cnc ON distribution_plan(channel_neutral_content_package_id);

-- ----------------------------------------------------------------------------
-- publication_receipt  (APPEND-ONLY; NO AUTOMATIC PUBLICATION)
-- Records that a specific channel of a DistributionPlan was actually published
-- to, at a specific time, by a specific (never automatic) actor.
-- published_by_actor_id is NOT NULL and a CHECK forbids the automatic/system
-- sentinels + blank, the concrete DB-level form of "No automatic publication
-- under any circumstance" — mirroring the frozen FORBIDDEN_AUTOMATIC_ACTOR_IDS
-- set in entities.ts.
-- ----------------------------------------------------------------------------
CREATE TABLE publication_receipt (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  distribution_plan_id     UUID NOT NULL REFERENCES distribution_plan(id),
  channel_id               TEXT NOT NULL,
  published_by_actor_id    TEXT NOT NULL,
  published_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- No automatic publication: the actor must be a real, non-blank, non-sentinel
  -- identity. Rejects 'system'/'auto'/'automated'/'automatic' (case-insensitive)
  -- and blank — matching entities.ts FORBIDDEN_AUTOMATIC_ACTOR_IDS.
  CONSTRAINT ck_publication_receipt_no_auto_publish CHECK (
    length(trim(published_by_actor_id)) > 0
    AND lower(trim(published_by_actor_id)) NOT IN ('system', 'auto', 'automated', 'automatic')
  )
);

CREATE INDEX ix_publication_receipt_client_org ON publication_receipt(client_organization_id);
CREATE INDEX ix_publication_receipt_project ON publication_receipt(project_id);
CREATE INDEX ix_publication_receipt_plan ON publication_receipt(distribution_plan_id);

CREATE OR REPLACE FUNCTION publication_receipt_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'publication_receipt is append-only: % is not permitted (a receipt is a permanent record)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_publication_receipt_forbid_update
  BEFORE UPDATE ON publication_receipt
  FOR EACH ROW EXECUTE FUNCTION publication_receipt_forbid_mutation();

CREATE TRIGGER trg_publication_receipt_forbid_delete
  BEFORE DELETE ON publication_receipt
  FOR EACH ROW EXECUTE FUNCTION publication_receipt_forbid_mutation();

-- ----------------------------------------------------------------------------
-- delivery  (APPEND-ONLY; CLIENT-READABLE PROJECTION)
-- The terminal, client-readable record that a publication receipt has been
-- delivered to the client for a specific channel. Written atomically alongside
-- its publication_receipt (see PgDeliveryRepository) so a delivery can never
-- exist without the receipt that authorized it. client_readable defaults to
-- true — a delivered artifact is visible to the client by default. Append-only:
-- a delivery record is permanent history.
-- ----------------------------------------------------------------------------
CREATE TABLE delivery (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  distribution_plan_id     UUID NOT NULL REFERENCES distribution_plan(id),
  publication_receipt_id   UUID NOT NULL REFERENCES publication_receipt(id),
  channel_id               TEXT NOT NULL,
  client_readable          BOOLEAN NOT NULL DEFAULT true,
  delivered_at             TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_delivery_receipt UNIQUE (publication_receipt_id)
);

CREATE INDEX ix_delivery_client_org ON delivery(client_organization_id);
CREATE INDEX ix_delivery_project ON delivery(project_id);
CREATE INDEX ix_delivery_plan ON delivery(distribution_plan_id);
CREATE INDEX ix_delivery_receipt ON delivery(publication_receipt_id);

CREATE OR REPLACE FUNCTION delivery_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'delivery is append-only: % is not permitted (a delivery record is permanent)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_delivery_forbid_update
  BEFORE UPDATE ON delivery
  FOR EACH ROW EXECUTE FUNCTION delivery_forbid_mutation();

CREATE TRIGGER trg_delivery_forbid_delete
  BEFORE DELETE ON delivery
  FOR EACH ROW EXECUTE FUNCTION delivery_forbid_mutation();

COMMIT;
