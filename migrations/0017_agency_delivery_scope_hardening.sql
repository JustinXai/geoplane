-- Defense in depth for AGENCY_DELIVERY_AND_GROWTH_V1 tenant/project scope.
BEGIN;
CREATE OR REPLACE FUNCTION enforce_agency_delivery_scope() RETURNS TRIGGER AS $$
DECLARE project_client UUID;
BEGIN
  SELECT client_organization_id INTO STRICT project_client FROM project WHERE id=NEW.project_id;
  IF project_client <> NEW.client_organization_id THEN
    RAISE EXCEPTION 'agency delivery project/client scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM agency_client_assignment WHERE agency_organization_id=NEW.agency_organization_id AND client_organization_id=NEW.client_organization_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'agency is not actively authorized for client' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM membership WHERE user_id=NEW.actor_user_id AND status='ACTIVE' AND ((organization_id=NEW.agency_organization_id AND role IN('AGENCY_OWNER','AGENCY_OPERATOR')) OR role='PLATFORM_SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'agency delivery operator membership required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_agency_workflow_scope BEFORE INSERT ON agency_workflow_event FOR EACH ROW EXECUTE FUNCTION enforce_agency_delivery_scope();
CREATE TRIGGER trg_agency_delivery_scope BEFORE INSERT ON agency_delivery_record FOR EACH ROW EXECUTE FUNCTION enforce_agency_delivery_scope();
COMMIT;
