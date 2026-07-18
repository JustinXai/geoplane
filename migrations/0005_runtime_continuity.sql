-- ============================================================================
-- Migration: 0005_runtime_continuity
-- Checkpoint: RUNTIME_DATA_CONTINUITY_V1 (Agent B / runtime/data-continuity-v1)
--
-- Scope: give a real, durable home to the geo-business aggregates that the
--   composition root previously kept in APPEND-ONLY IN-MEMORY adapters (see
--   src/composition/pg-application-runtime.ts, "Deliberately-transient
--   aggregates"). Two — and only two — tables are added here, ONLY for the
--   aggregates that have no existing persistent home:
--
--     1. industry_profile          — the vertical/industry classification
--                                     context a project's knowledge/keywords are
--                                     validated against. Tenant + project scoped,
--                                     ONE canonical profile per project.
--     2. provider_article_content  — the append-only, versioned store of the
--                                     DETERMINISTIC offline-provider output for
--                                     an ArticleBrief, so generated content
--                                     survives a process restart.
--
-- Deliberately NOT created here: a second knowledge_package table. The
--   geo-business KnowledgePackage aggregate is bridged onto migration 0002's
--   existing knowledge_package table (the SINGLE SOURCE OF TRUTH for enterprise
--   knowledge) by src/persistence/runtime-continuity/knowledge-package-bridge.ts.
--   There is no duplicate copy of enterprise knowledge anywhere.
--
-- Provider Calls = 0: provider_article_content stores only an OPAQUE pointer to
--   an out-of-band provider envelope (provider_response_envelope_id), never the
--   raw payload — persisting it is data movement, not a provider call. There is
--   no provider/network surface anywhere in this schema.
--
-- Tenancy: both tables are tenant-scoped (client_organization_id NOT NULL, real
--   FK to organization) AND project-scoped (project_id NOT NULL, real FK to
--   project). This migration foreign-keys out to ONLY 0001's organization(id)
--   and project(id). article_brief_id (a 0004 aggregate) and
--   provider_response_envelope_id (an out-of-band envelope store) are plain
--   columns, NOT foreign keys — the same deliberate "polymorphic reference to an
--   out-of-scope module" pattern 0003 uses for its knowledge_package_id /
--   industry_profile_id columns. It does not alter any 0001-0004 object.
--
-- Append-only history (docs/governance/SYSTEM_INVARIANTS_V1.md, "historical
--   artifacts are never mutated"): provider_article_content is append-only —
--   a re-generated envelope is a NEW versioned row, never an in-place edit.
--   UPDATE and DELETE are forbidden at the database level by triggers (same
--   pattern as 0003's trg_opportunity_validation_forbid_*), so recorded provider
--   output cannot be rewritten even by a compromised app credential. TRUNCATE
--   (used by the test harness) bypasses row-level triggers by design.
--
--   industry_profile is intentionally NOT append-only: it is a single canonical
--   record per project that is re-classified in place (updated_at bumped) via
--   the adapter's upsert path, so it carries no forbid-mutation trigger.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- industry_profile
-- The vertical/industry classification context (geo-business IndustryProfile,
-- src/contracts/geo-business/entities.ts) a client's KnowledgePackage content
-- and KeywordQuestionMap entries are validated against. ONE canonical profile
-- per (client_organization_id, project_id): a project has a single industry
-- classification at a time, re-classified in place rather than duplicated.
-- ----------------------------------------------------------------------------
CREATE TABLE industry_profile (
  id                       UUID PRIMARY KEY,
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  project_id               UUID NOT NULL REFERENCES project(id),
  -- Machine-facing slug, e.g. "healthcare", "b2b-saas".
  vertical_slug            TEXT NOT NULL,
  -- Human-readable label, e.g. "Healthcare & Life Sciences".
  vertical_label           TEXT NOT NULL,
  -- PLATFORM_WIDE_GATE | INDUSTRY_VERTICAL_GATE  (GeoValidationGateLevel);
  -- literal values mirror the frozen contract so rows map with no translation.
  validation_gate_level    TEXT NOT NULL,
  rule_set_version         INTEGER NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_industry_profile_gate_level
    CHECK (validation_gate_level IN ('PLATFORM_WIDE_GATE', 'INDUSTRY_VERTICAL_GATE')),
  CONSTRAINT ck_industry_profile_vertical_slug_not_blank
    CHECK (length(trim(vertical_slug)) > 0),
  CONSTRAINT ck_industry_profile_vertical_label_not_blank
    CHECK (length(trim(vertical_label)) > 0),
  CONSTRAINT ck_industry_profile_rule_set_version_nonneg
    CHECK (rule_set_version >= 0),
  -- One canonical IndustryProfile per project.
  CONSTRAINT uq_industry_profile_per_project
    UNIQUE (client_organization_id, project_id)
);

CREATE INDEX ix_industry_profile_client_org ON industry_profile(client_organization_id);
CREATE INDEX ix_industry_profile_project ON industry_profile(project_id);

-- ----------------------------------------------------------------------------
-- provider_article_content
-- Append-only, versioned store of the DETERMINISTIC offline-provider output for
-- an ArticleBrief (geo-business ProviderArticleContent). Persisting these rows
-- is what lets generated content survive a restart WITHOUT re-calling a
-- provider. The geo-business contract carries no version field; `version` here
-- is the persistence-level, per-brief monotonic version the adapter assigns on
-- append, so appended envelopes stay ordered and re-open cleanly after a
-- restart.
-- ----------------------------------------------------------------------------
CREATE TABLE provider_article_content (
  id                            UUID PRIMARY KEY,
  client_organization_id        UUID NOT NULL REFERENCES organization(id),
  project_id                    UUID NOT NULL REFERENCES project(id),
  -- Not a FK: the geo-business ArticleBrief lives in 0004, outside this
  -- migration's FK scope (FKs only to 0001/0002). Polymorphic reference, the
  -- same pattern 0003 uses for knowledge_package_id.
  article_brief_id              UUID NOT NULL,
  -- OPAQUE out-of-band pointer to the raw provider envelope — NEVER the raw
  -- payload itself (SYSTEM_INVARIANTS_V1 "no customer data, no secrets"). This
  -- is why persisting a row is not a provider call.
  provider_response_envelope_id TEXT NOT NULL,
  -- Monotonic per article_brief_id, assigned by the adapter on append.
  version                       INTEGER NOT NULL,
  received_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_provider_article_content_envelope_not_blank
    CHECK (length(trim(provider_response_envelope_id)) > 0),
  CONSTRAINT ck_provider_article_content_version_positive
    CHECK (version >= 1),
  -- A brief's versions are unique — two appends can never claim the same
  -- version, so the ordered history is unambiguous.
  CONSTRAINT uq_provider_article_content_brief_version
    UNIQUE (article_brief_id, version)
);

CREATE INDEX ix_provider_article_content_client_org ON provider_article_content(client_organization_id);
CREATE INDEX ix_provider_article_content_project ON provider_article_content(project_id);
CREATE INDEX ix_provider_article_content_brief ON provider_article_content(article_brief_id);

-- Append-only: an ingested provider envelope is history and may never be edited
-- in place or deleted. A re-generation is a new versioned row. Same DB-level
-- guarantee as 0003's opportunity_validation / human_review_decision.
CREATE OR REPLACE FUNCTION provider_article_content_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'provider_article_content is append-only: % is not permitted (append a new version instead)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_provider_article_content_forbid_update
  BEFORE UPDATE ON provider_article_content
  FOR EACH ROW EXECUTE FUNCTION provider_article_content_forbid_mutation();

CREATE TRIGGER trg_provider_article_content_forbid_delete
  BEFORE DELETE ON provider_article_content
  FOR EACH ROW EXECUTE FUNCTION provider_article_content_forbid_mutation();

COMMIT;
