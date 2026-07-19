-- RECOVERED_SPECIFIED_NOT_COMPLETED: current reconstructed offline expansion runtime.
BEGIN;
CREATE TABLE keyword_expansion_batch (
 id TEXT PRIMARY KEY, client_organization_id UUID NOT NULL REFERENCES organization(id),
 project_id UUID NOT NULL REFERENCES project(id), version INTEGER NOT NULL CHECK(version > 0),
 generator TEXT NOT NULL CHECK(generator='DETERMINISTIC_OFFLINE'), generator_version TEXT NOT NULL,
 input_snapshot JSONB NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 requested_by_user_id UUID NOT NULL REFERENCES "user"(id), created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE keyword_expansion_candidate (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES keyword_expansion_batch(id),
 keyword TEXT NOT NULL CHECK(length(trim(keyword))>0), question TEXT NULL,
 reason TEXT NOT NULL, confidence NUMERIC NOT NULL CHECK(confidence>=0 AND confidence<=1)
);
CREATE TABLE keyword_expansion_review_event (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id TEXT NOT NULL REFERENCES keyword_expansion_candidate(id),
 status TEXT NOT NULL CHECK(status IN ('CONFIRMED','DELETED')), actor_user_id UUID NOT NULL REFERENCES "user"(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), created_at TIMESTAMPTZ NOT NULL,
 CONSTRAINT uq_keyword_expansion_review_once UNIQUE(candidate_id)
);
CREATE OR REPLACE FUNCTION keyword_expansion_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'keyword expansion history is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_expansion_batch_no_mutation BEFORE UPDATE OR DELETE ON keyword_expansion_batch FOR EACH ROW EXECUTE FUNCTION keyword_expansion_forbid_mutation();
CREATE TRIGGER trg_expansion_candidate_no_mutation BEFORE UPDATE OR DELETE ON keyword_expansion_candidate FOR EACH ROW EXECUTE FUNCTION keyword_expansion_forbid_mutation();
CREATE TRIGGER trg_expansion_review_no_mutation BEFORE UPDATE OR DELETE ON keyword_expansion_review_event FOR EACH ROW EXECUTE FUNCTION keyword_expansion_forbid_mutation();
COMMIT;
