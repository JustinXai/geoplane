-- ACCOUNT_CENTER_HARDENING_V1
-- Forward-only hardening for the already-checkpointed 0010 account-center migration.
BEGIN;

ALTER TABLE platform_account
  ADD CONSTRAINT ck_platform_account_secret_reference
  CHECK (secret_reference IS NULL OR secret_reference ~ '^secretref://[A-Za-z0-9][A-Za-z0-9._/-]{2,253}$');

CREATE OR REPLACE FUNCTION enforce_account_result_receipt_scope() RETURNS TRIGGER AS $$
DECLARE task_client UUID; task_project UUID; task_account UUID; task_assignment UUID; assignment_client UUID; assignment_project UUID; receipt_client UUID; receipt_project UUID;
BEGIN
  SELECT client_organization_id,project_id,account_id,assignment_id INTO STRICT task_client,task_project,task_account,task_assignment FROM account_operation_task WHERE id=NEW.task_id;
  IF task_account <> NEW.account_id THEN RAISE EXCEPTION 'operation result account must match task' USING ERRCODE='23514'; END IF;
  SELECT client_organization_id,project_id INTO STRICT assignment_client,assignment_project FROM account_assignment WHERE id=task_assignment AND status='ACTIVE';
  IF assignment_client <> task_client OR assignment_project <> task_project THEN RAISE EXCEPTION 'operation task scope must match active assignment' USING ERRCODE='23514'; END IF;
  IF NEW.publication_receipt_id IS NOT NULL THEN
    SELECT client_organization_id,project_id INTO STRICT receipt_client,receipt_project FROM publication_receipt WHERE id=NEW.publication_receipt_id;
    IF receipt_client <> task_client OR receipt_project <> task_project THEN RAISE EXCEPTION 'publication receipt scope must match operation task' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_account_result_receipt_scope BEFORE INSERT ON account_operation_result
  FOR EACH ROW EXECUTE FUNCTION enforce_account_result_receipt_scope();

COMMIT;
