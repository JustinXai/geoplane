-- RECONSTRUCTED_FROM_FROZEN_SPEC
-- Cross-industry, append-only policy-pack persistence. Static pack data is registered by runtime;
-- this migration contains no industry-specific seed data and no source-collection dependency.
BEGIN;

CREATE TABLE vertical_policy_pack_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pack_id TEXT NOT NULL, vertical_slug TEXT NOT NULL,
  version INTEGER NOT NULL, effective_from TIMESTAMPTZ NOT NULL, mandatory_human_review BOOLEAN NOT NULL,
  evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vertical_policy_pack_version UNIQUE(pack_id,version),
  CONSTRAINT ck_vertical_policy_pack_identity CHECK(length(trim(pack_id))>0 AND length(trim(vertical_slug))>0 AND version>0),
  CONSTRAINT ck_vertical_policy_pack_evidence_array CHECK(jsonb_typeof(evidence_references)='array')
);

CREATE TABLE vertical_rule_definition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pack_definition_id UUID NOT NULL REFERENCES vertical_policy_pack_definition(id),
  rule_id TEXT NOT NULL, category TEXT NOT NULL, layer TEXT NOT NULL, evaluation_mode TEXT NOT NULL,
  evidence_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_vertical_rule_in_pack UNIQUE(pack_definition_id,rule_id),
  CONSTRAINT ck_vertical_rule_identity CHECK(length(trim(rule_id))>0 AND length(trim(category))>0),
  CONSTRAINT ck_vertical_rule_layer CHECK(layer IN ('PLATFORM_RULE_GATE','VERTICAL_RULE_GATE')),
  CONSTRAINT ck_vertical_rule_mode CHECK(evaluation_mode IN ('DETERMINISTIC','MANUAL_CONFIRMATION')),
  CONSTRAINT ck_vertical_rule_evidence_array CHECK(jsonb_typeof(evidence_references)='array')
);

CREATE TABLE industry_profile_pack_selection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project(id),
  industry_profile_id UUID NOT NULL REFERENCES industry_profile(id), pack_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL, selected_by_user_id UUID NOT NULL REFERENCES "user"(id),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT ck_industry_pack_version CHECK(pack_version>0)
);
CREATE UNIQUE INDEX uq_industry_profile_active_pack ON industry_profile_pack_selection(project_id,industry_profile_id)
  WHERE revoked_at IS NULL;

CREATE TABLE vertical_rule_evaluation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES project(id),
  industry_profile_id UUID NOT NULL REFERENCES industry_profile(id), article_draft_id UUID NOT NULL REFERENCES article_draft(id),
  pack_id TEXT NOT NULL, pack_version INTEGER NOT NULL, rule_id TEXT NOT NULL, category TEXT NOT NULL,
  layer TEXT NOT NULL, status TEXT NOT NULL, failure_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluated_by_user_id UUID NOT NULL REFERENCES "user"(id), evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_vertical_rule_evaluation_status CHECK(status IN ('PASSED','FAILED')),
  CONSTRAINT ck_vertical_rule_failure_reason CHECK((status='PASSED' AND failure_reasons='[]'::jsonb) OR (status='FAILED' AND jsonb_array_length(failure_reasons)>0))
);

CREATE OR REPLACE FUNCTION reject_policy_history_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'policy definitions and evaluations are append-only' USING ERRCODE='55000'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_policy_pack_append_only BEFORE UPDATE OR DELETE ON vertical_policy_pack_definition
  FOR EACH ROW EXECUTE FUNCTION reject_policy_history_mutation();
CREATE TRIGGER trg_vertical_rule_append_only BEFORE UPDATE OR DELETE ON vertical_rule_definition
  FOR EACH ROW EXECUTE FUNCTION reject_policy_history_mutation();
CREATE TRIGGER trg_vertical_evaluation_append_only BEFORE UPDATE OR DELETE ON vertical_rule_evaluation
  FOR EACH ROW EXECUTE FUNCTION reject_policy_history_mutation();

COMMIT;
