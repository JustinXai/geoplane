-- Manual-only China AI probe observations. This is not a provider execution table.
BEGIN;
CREATE TABLE raw_probe_result (
  id UUID PRIMARY KEY,
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  platform TEXT NOT NULL CHECK (platform IN ('DOUBAO','QWEN','DEEPSEEK','YUANBAO')),
  collection_mode TEXT NOT NULL CHECK (collection_mode = 'MANUAL_SAMPLE'),
  question TEXT NOT NULL CHECK (length(trim(question)) > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('ANSWERED','FAILED')),
  answer_text TEXT NULL,
  screenshot_reference TEXT NULL,
  failure_code TEXT NULL CHECK (failure_code IS NULL OR failure_code IN
    ('MANUAL_ACCESS_UNAVAILABLE','ANSWER_NOT_RETURNED','CAPTURE_INCOMPLETE','OTHER')),
  failure_message TEXT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by_user_id UUID NOT NULL REFERENCES "user"(id),
  CONSTRAINT ck_raw_probe_result_outcome CHECK (
    (outcome='ANSWERED' AND answer_text IS NOT NULL AND length(trim(answer_text)) > 0
      AND failure_code IS NULL AND failure_message IS NULL)
    OR
    (outcome='FAILED' AND answer_text IS NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX ix_raw_probe_result_scope ON raw_probe_result(client_organization_id, project_id, observed_at);
CREATE OR REPLACE FUNCTION raw_probe_result_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'raw_probe_result is append-only: % is not permitted', TG_OP; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_raw_probe_result_forbid_update BEFORE UPDATE ON raw_probe_result
  FOR EACH ROW EXECUTE FUNCTION raw_probe_result_forbid_mutation();
CREATE TRIGGER trg_raw_probe_result_forbid_delete BEFORE DELETE ON raw_probe_result
  FOR EACH ROW EXECUTE FUNCTION raw_probe_result_forbid_mutation();
COMMIT;
