-- DOMESTIC_ACCOUNT_CENTER_V1 / ACCOUNT_CENTER_CONTRACT_AND_SCHEMA_V1
-- Stores references to credentials only. Plaintext passwords, cookies, tokens and API keys
-- have no columns in this schema.
BEGIN;

CREATE TABLE platform_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_code TEXT NOT NULL,
  account_type TEXT NOT NULL,
  ownership TEXT NOT NULL,
  agency_organization_id UUID NULL REFERENCES organization(id),
  client_organization_id UUID NULL REFERENCES organization(id),
  display_label TEXT NOT NULL,
  secret_reference TEXT NULL,
  credential_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_verified_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  operation_mode TEXT NOT NULL DEFAULT 'MANUAL_OPERATION',
  created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_platform_account_platform CHECK (length(trim(platform_code)) > 0),
  CONSTRAINT ck_platform_account_label CHECK (length(trim(display_label)) > 0),
  CONSTRAINT ck_platform_account_type CHECK (account_type IN ('AI_PLATFORM_ACCOUNT','CONTENT_PLATFORM_ACCOUNT')),
  CONSTRAINT ck_platform_account_ownership CHECK (ownership IN ('PLATFORM_OWNED','CLIENT_OWNED','AGENCY_OWNED')),
  CONSTRAINT ck_platform_account_owner_shape CHECK (
    (ownership = 'PLATFORM_OWNED' AND agency_organization_id IS NULL AND client_organization_id IS NULL) OR
    (ownership = 'CLIENT_OWNED' AND agency_organization_id IS NULL AND client_organization_id IS NOT NULL) OR
    (ownership = 'AGENCY_OWNED' AND agency_organization_id IS NOT NULL AND client_organization_id IS NULL)
  ),
  CONSTRAINT ck_platform_account_credential CHECK (credential_status IN ('NOT_CONFIGURED','UNVERIFIED','VERIFIED','EXPIRED','REVOKED')),
  CONSTRAINT ck_platform_account_status CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  CONSTRAINT ck_platform_account_mode CHECK (operation_mode IN ('MANUAL_OPERATION','ASSISTED_OPERATION','SCHEDULED_CONTROLLED_TASK'))
);
CREATE INDEX ix_platform_account_client ON platform_account(client_organization_id);
CREATE INDEX ix_platform_account_agency ON platform_account(agency_organization_id);

CREATE TABLE account_authorization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES platform_account(id),
  client_organization_id UUID NULL REFERENCES organization(id),
  agency_organization_id UUID NULL REFERENCES organization(id),
  status TEXT NOT NULL,
  authorized_by_user_id UUID NOT NULL REFERENCES "user"(id),
  authorized_at TIMESTAMPTZ NULL,
  revoked_by_user_id UUID NULL REFERENCES "user"(id),
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_authorization_scope CHECK (num_nonnulls(client_organization_id, agency_organization_id) <= 1),
  CONSTRAINT ck_account_authorization_status CHECK (status IN ('PENDING','AUTHORIZED','REVOKED')),
  CONSTRAINT ck_account_authorization_times CHECK (
    (status = 'PENDING' AND authorized_at IS NULL AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'AUTHORIZED' AND authorized_at IS NOT NULL AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'REVOKED' AND authorized_at IS NOT NULL AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_account_authorization_active ON account_authorization(account_id)
  WHERE status = 'AUTHORIZED';

CREATE TABLE account_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES platform_account(id),
  project_id UUID NOT NULL REFERENCES project(id),
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  operator_user_id UUID NOT NULL REFERENCES "user"(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  assigned_by_user_id UUID NOT NULL REFERENCES "user"(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT ck_account_assignment_status CHECK (status IN ('ACTIVE','REVOKED')),
  CONSTRAINT ck_account_assignment_revoked CHECK ((status='ACTIVE' AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_account_assignment_active_project ON account_assignment(account_id, project_id)
  WHERE status = 'ACTIVE';
CREATE INDEX ix_account_assignment_project ON account_assignment(project_id);

CREATE OR REPLACE FUNCTION enforce_account_assignment_scope() RETURNS TRIGGER AS $$
DECLARE account_row platform_account%ROWTYPE; project_client UUID;
BEGIN
  SELECT * INTO STRICT account_row FROM platform_account WHERE id = NEW.account_id;
  SELECT client_organization_id INTO STRICT project_client FROM project WHERE id = NEW.project_id;
  IF project_client <> NEW.client_organization_id THEN
    RAISE EXCEPTION 'account assignment client must own project' USING ERRCODE='23514';
  END IF;
  IF account_row.ownership = 'CLIENT_OWNED' AND account_row.client_organization_id <> NEW.client_organization_id THEN
    RAISE EXCEPTION 'client-owned account cannot cross client boundary' USING ERRCODE='23514';
  END IF;
  IF account_row.ownership = 'PLATFORM_OWNED' AND NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'platform-owned account requires project assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_enforce_account_assignment_scope BEFORE INSERT OR UPDATE ON account_assignment
  FOR EACH ROW EXECUTE FUNCTION enforce_account_assignment_scope();

CREATE TABLE account_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES platform_account(id),
  health_status TEXT NOT NULL, risk_status TEXT NOT NULL, daily_usage_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0, last_exception TEXT NULL, last_executed_at TIMESTAMPTZ NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_health CHECK (health_status IN ('UNKNOWN','HEALTHY','DEGRADED','UNAVAILABLE')),
  CONSTRAINT ck_account_risk CHECK (risk_status IN ('UNKNOWN','NORMAL','ATTENTION','BLOCKED')),
  CONSTRAINT ck_account_counts CHECK (daily_usage_count >= 0 AND failure_count >= 0)
);
CREATE INDEX ix_account_health_account ON account_health(account_id, checked_at DESC);

CREATE TABLE account_usage_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES platform_account(id),
  project_id UUID NOT NULL REFERENCES project(id), client_organization_id UUID NOT NULL REFERENCES organization(id),
  operator_user_id UUID NOT NULL REFERENCES "user"(id), operation_kind TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL, failure_category TEXT NULL, occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_usage_kind CHECK (length(trim(operation_kind)) > 0),
  CONSTRAINT ck_account_usage_failure CHECK ((succeeded AND failure_category IS NULL) OR NOT succeeded)
);

CREATE TABLE account_operation_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES platform_account(id),
  assignment_id UUID NOT NULL REFERENCES account_assignment(id), project_id UUID NOT NULL REFERENCES project(id),
  client_organization_id UUID NOT NULL REFERENCES organization(id), operation_kind TEXT NOT NULL,
  operation_mode TEXT NOT NULL DEFAULT 'MANUAL_OPERATION', status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by_user_id UUID NOT NULL REFERENCES "user"(id), operator_user_id UUID NOT NULL REFERENCES "user"(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ NULL, completed_at TIMESTAMPTZ NULL,
  CONSTRAINT ck_account_task_kind CHECK (length(trim(operation_kind)) > 0),
  CONSTRAINT ck_account_task_mode CHECK (operation_mode IN ('MANUAL_OPERATION','ASSISTED_OPERATION','SCHEDULED_CONTROLLED_TASK')),
  CONSTRAINT ck_account_task_status CHECK (status IN ('PENDING','IN_PROGRESS','SUCCEEDED','FAILED','CANCELLED')),
  CONSTRAINT ck_account_task_completion CHECK ((status IN ('SUCCEEDED','FAILED','CANCELLED') AND completed_at IS NOT NULL) OR (status IN ('PENDING','IN_PROGRESS') AND completed_at IS NULL))
);

CREATE TABLE account_operation_result (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL UNIQUE REFERENCES account_operation_task(id),
  account_id UUID NOT NULL REFERENCES platform_account(id), status TEXT NOT NULL,
  result_summary TEXT NULL, failure_category TEXT NULL, publication_receipt_id UUID NULL REFERENCES publication_receipt(id),
  recorded_by_user_id UUID NOT NULL REFERENCES "user"(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_account_result_status CHECK (status IN ('SUCCEEDED','FAILED')),
  CONSTRAINT ck_account_result_failure CHECK ((status='SUCCEEDED' AND failure_category IS NULL) OR status='FAILED')
);

-- Usage and result rows are historical ledgers. Database-level mutation denial closes bypasses.
CREATE OR REPLACE FUNCTION reject_account_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'account operation ledgers are append-only' USING ERRCODE='55000'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_account_usage_append_only BEFORE UPDATE OR DELETE ON account_usage_record
  FOR EACH ROW EXECUTE FUNCTION reject_account_ledger_mutation();
CREATE TRIGGER trg_account_result_append_only BEFORE UPDATE OR DELETE ON account_operation_result
  FOR EACH ROW EXECUTE FUNCTION reject_account_ledger_mutation();

COMMIT;

