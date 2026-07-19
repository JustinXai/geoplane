-- BAIDU_KEYWORD_RUNTIME_V1. Reconstructed from the frozen P0 recovery contract.
-- No historical keyword assets or unverified historical counts are embedded here.
BEGIN;

CREATE TABLE keyword_reference_source_import (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  source_kind TEXT NOT NULL CHECK (source_kind = 'BAIDU_REFERENCE_EXPORT'),
  source_format TEXT NOT NULL CHECK (source_format IN ('CSV', 'XLSX')),
  source_file_name TEXT NOT NULL CHECK (length(trim(source_file_name)) > 0),
  source_manifest_hash TEXT NOT NULL CHECK (source_manifest_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'VALIDATED', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  parsed_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  UNIQUE (client_organization_id, project_id, source_manifest_hash),
  CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL) OR status <> 'COMPLETED')
);

CREATE TABLE keyword_raw_observation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  import_id UUID NOT NULL REFERENCES keyword_reference_source_import(id),
  source_locator TEXT NOT NULL,
  seed_keyword TEXT NOT NULL CHECK (length(trim(seed_keyword)) > 0),
  raw_keyword TEXT NOT NULL CHECK (length(trim(raw_keyword)) > 0),
  demand_value NUMERIC,
  observed_at TIMESTAMPTZ NOT NULL,
  raw_record_hash TEXT NOT NULL CHECK (raw_record_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (import_id, raw_record_hash),
  UNIQUE (id, client_organization_id, project_id)
);

CREATE TABLE keyword_normalized_form (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  raw_observation_id UUID NOT NULL REFERENCES keyword_raw_observation(id),
  normalized_keyword TEXT NOT NULL CHECK (length(trim(normalized_keyword)) > 0),
  normalization_rule_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (raw_observation_id, normalization_rule_version),
  UNIQUE (id, client_organization_id, project_id)
);

CREATE TABLE keyword_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  normalized_form_id UUID NOT NULL REFERENCES keyword_normalized_form(id),
  seed_keyword TEXT NOT NULL CHECK (length(trim(seed_keyword)) > 0),
  discovery_method TEXT NOT NULL CHECK (discovery_method = 'IMPORTED_SEED_EXPANSION'),
  discovered_at TIMESTAMPTZ NOT NULL,
  UNIQUE (normalized_form_id, seed_keyword)
);

CREATE TABLE keyword_demand_observation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  normalized_form_id UUID NOT NULL REFERENCES keyword_normalized_form(id),
  raw_observation_id UUID NOT NULL REFERENCES keyword_raw_observation(id),
  evidence_status TEXT NOT NULL CHECK (evidence_status = 'OBSERVED_DEMAND'),
  metric_kind TEXT NOT NULL CHECK (metric_kind = 'BAIDU_DEMAND_INDEX'),
  metric_value NUMERIC NOT NULL CHECK (metric_value >= 0),
  observed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (normalized_form_id, raw_observation_id, metric_kind)
);

CREATE TABLE keyword_reference_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  import_id UUID NOT NULL REFERENCES keyword_reference_source_import(id),
  snapshot_version INTEGER NOT NULL CHECK (snapshot_version >= 1),
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  raw_observation_count INTEGER NOT NULL CHECK (raw_observation_count >= 0),
  normalized_form_count INTEGER NOT NULL CHECK (normalized_form_count >= 0),
  demand_observation_count INTEGER NOT NULL CHECK (demand_observation_count >= 0),
  sealed_at TIMESTAMPTZ NOT NULL,
  UNIQUE (client_organization_id, project_id, snapshot_version),
  UNIQUE (id, client_organization_id, project_id)
);

CREATE TABLE keyword_taxonomy_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  parent_version_id UUID REFERENCES keyword_taxonomy_version(id),
  published_at TIMESTAMPTZ,
  UNIQUE (client_organization_id, project_id, version),
  UNIQUE (id, client_organization_id, project_id),
  CHECK ((status = 'PUBLISHED' AND published_at IS NOT NULL) OR status = 'DRAFT')
);

CREATE TABLE keyword_classification_version (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  normalized_form_id UUID NOT NULL REFERENCES keyword_normalized_form(id),
  taxonomy_version_id UUID NOT NULL REFERENCES keyword_taxonomy_version(id),
  category_key TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (normalized_form_id, taxonomy_version_id)
);

CREATE TABLE keyword_family_draft (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  snapshot_id UUID NOT NULL REFERENCES keyword_reference_snapshot(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED')),
  created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (client_organization_id, project_id, id, version),
  UNIQUE (id, client_organization_id, project_id)
);

CREATE TABLE keyword_family_draft_member (
  family_draft_id UUID NOT NULL REFERENCES keyword_family_draft(id),
  normalized_form_id UUID NOT NULL REFERENCES keyword_normalized_form(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (family_draft_id, normalized_form_id),
  UNIQUE (family_draft_id, position)
);

CREATE TABLE keyword_human_review_package (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  snapshot_id UUID NOT NULL REFERENCES keyword_reference_snapshot(id),
  package_version INTEGER NOT NULL CHECK (package_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'IN_REVIEW', 'COMPLETED')),
  submitted_by_user_id UUID NOT NULL REFERENCES "user"(id),
  submitted_at TIMESTAMPTZ NOT NULL,
  UNIQUE (client_organization_id, project_id, package_version),
  UNIQUE (id, client_organization_id, project_id)
);

CREATE TABLE keyword_human_review_package_item (
  review_package_id UUID NOT NULL REFERENCES keyword_human_review_package(id),
  family_draft_id UUID NOT NULL REFERENCES keyword_family_draft(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (review_package_id, family_draft_id),
  UNIQUE (review_package_id, position)
);

CREATE TABLE keyword_human_review_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  review_package_id UUID NOT NULL REFERENCES keyword_human_review_package(id),
  family_draft_id UUID NOT NULL REFERENCES keyword_family_draft(id),
  decision TEXT NOT NULL CHECK (decision IN ('CONFIRMED', 'CHANGES_REQUESTED', 'REJECTED')),
  reviewer_user_id UUID NOT NULL REFERENCES "user"(id),
  decided_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  UNIQUE (review_package_id, family_draft_id, id),
  CHECK (decision = 'CONFIRMED' OR length(trim(coalesce(note, ''))) > 0)
);

CREATE INDEX ix_keyword_raw_scope ON keyword_raw_observation(client_organization_id, project_id);
CREATE INDEX ix_keyword_normalized_value ON keyword_normalized_form(client_organization_id, project_id, normalized_keyword);
CREATE INDEX ix_keyword_discovery_seed ON keyword_discovery(client_organization_id, project_id, seed_keyword);
CREATE INDEX ix_keyword_demand_scope ON keyword_demand_observation(client_organization_id, project_id);
CREATE INDEX ix_keyword_review_scope ON keyword_human_review_record(client_organization_id, project_id);

CREATE OR REPLACE FUNCTION keyword_runtime_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'keyword_raw_observation', 'keyword_normalized_form', 'keyword_discovery',
    'keyword_demand_observation', 'keyword_reference_snapshot',
    'keyword_classification_version', 'keyword_human_review_record'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_no_update BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION keyword_runtime_forbid_mutation()', table_name, table_name);
  END LOOP;
END $$;

COMMIT;
