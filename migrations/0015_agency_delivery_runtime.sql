-- AGENCY_DELIVERY_AND_GROWTH_V1. No billing, commission, subscription or white-label state.
BEGIN;
CREATE TABLE agency_workflow_event(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),agency_organization_id UUID NOT NULL REFERENCES organization(id),client_organization_id UUID NOT NULL REFERENCES organization(id),project_id UUID NOT NULL REFERENCES project(id),stage TEXT NOT NULL CHECK(stage IN('CLIENT_PROFILE','PROJECT_PROFILE','ENTERPRISE_KNOWLEDGE','ACCOUNT_AUTHORIZATION','BAIDU_KEYWORDS','AI_EXPANSION','USER_QUESTION_CONFIRMATION','CONTENT_TASK','CONTENT_REVIEW','CHINA_AI_PROBE','REPORT','DELIVERY','RETROSPECTIVE')),from_status TEXT NOT NULL CHECK(from_status IN('NOT_STARTED','IN_PROGRESS','WAITING_CLIENT','BLOCKED','COMPLETED')),to_status TEXT NOT NULL CHECK(to_status IN('NOT_STARTED','IN_PROGRESS','WAITING_CLIENT','BLOCKED','COMPLETED')),actor_user_id UUID NOT NULL REFERENCES "user"(id),reason TEXT NOT NULL CHECK(length(trim(reason))>0),occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_agency_workflow_scope ON agency_workflow_event(agency_organization_id,client_organization_id,project_id,occurred_at);
CREATE TABLE agency_delivery_record(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),agency_organization_id UUID NOT NULL REFERENCES organization(id),client_organization_id UUID NOT NULL REFERENCES organization(id),project_id UUID NOT NULL REFERENCES project(id),status TEXT NOT NULL CHECK(status IN('READY','DELIVERED')),actor_user_id UUID NOT NULL REFERENCES "user"(id),occurred_at TIMESTAMPTZ NOT NULL,receipt_reference TEXT,
 CHECK(status<>'DELIVERED' OR length(trim(coalesce(receipt_reference,'')))>0)
);
CREATE INDEX ix_agency_delivery_scope ON agency_delivery_record(agency_organization_id,client_organization_id,project_id,occurred_at);
CREATE OR REPLACE FUNCTION agency_delivery_forbid_mutation() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_agency_workflow_immutable BEFORE UPDATE OR DELETE ON agency_workflow_event FOR EACH ROW EXECUTE FUNCTION agency_delivery_forbid_mutation();
CREATE TRIGGER trg_agency_delivery_immutable BEFORE UPDATE OR DELETE ON agency_delivery_record FOR EACH ROW EXECUTE FUNCTION agency_delivery_forbid_mutation();
COMMIT;
