-- GENERIC_KEYWORD_CORE_V1. Source-neutral keyword datasets; 0001-0017 remain frozen.
BEGIN;

CREATE TABLE keyword_dataset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id), name TEXT NOT NULL CHECK(length(trim(name))>0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('MANUAL','GENERIC_FILE','BAIDU_KEYWORD','CUSTOMER_HISTORY','OTHER_PROVIDER')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')), created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL, UNIQUE(id,client_organization_id,project_id)
);

CREATE TABLE keyword_import_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id),
  dataset_id UUID NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('GENERIC_FILE','BAIDU_KEYWORD','CUSTOMER_HISTORY','OTHER_PROVIDER')),
  source_format TEXT NOT NULL CHECK(source_format IN ('CSV','XLSX')), source_file_name TEXT NOT NULL CHECK(length(trim(source_file_name))>0),
  manifest_hash TEXT NOT NULL CHECK(manifest_hash ~ '^[0-9a-f]{64}$'), status TEXT NOT NULL CHECK(status IN ('COMPLETED','FAILED')),
  accepted_count INTEGER NOT NULL CHECK(accepted_count>=0), rejected_count INTEGER NOT NULL CHECK(rejected_count>=0),
  imported_by_user_id UUID NOT NULL REFERENCES "user"(id), imported_at TIMESTAMPTZ NOT NULL,
  UNIQUE(dataset_id,manifest_hash), UNIQUE(id,client_organization_id,project_id),
  FOREIGN KEY(dataset_id,client_organization_id,project_id) REFERENCES keyword_dataset(id,client_organization_id,project_id)
);

CREATE TABLE keyword_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id),
  dataset_id UUID NOT NULL, import_batch_id UUID, keyword TEXT NOT NULL CHECK(length(trim(keyword))>0), normalized_keyword TEXT NOT NULL CHECK(length(trim(normalized_keyword))>0),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('MANUAL','GENERIC_FILE','BAIDU_KEYWORD','CUSTOMER_HISTORY','OTHER_PROVIDER')),
  category TEXT, note TEXT, region TEXT, period_start DATE, period_end DATE,
  created_by_user_id UUID NOT NULL REFERENCES "user"(id), created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(id,client_organization_id,project_id), FOREIGN KEY(dataset_id,client_organization_id,project_id) REFERENCES keyword_dataset(id,client_organization_id,project_id),
  FOREIGN KEY(import_batch_id,client_organization_id,project_id) REFERENCES keyword_import_batch(id,client_organization_id,project_id),
  CHECK(period_end IS NULL OR period_start IS NULL OR period_end>=period_start)
);

CREATE TABLE demand_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id),
  keyword_record_id UUID NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('GENERIC_FILE','BAIDU_KEYWORD','CUSTOMER_HISTORY','OTHER_PROVIDER')),
  metric_kind TEXT NOT NULL CHECK(length(trim(metric_kind))>0), metric_value NUMERIC NOT NULL CHECK(metric_value>=0), metric_unit TEXT,
  region TEXT, period_start DATE, period_end DATE, source_reference TEXT NOT NULL CHECK(length(trim(source_reference))>0),
  observed_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(keyword_record_id,client_organization_id,project_id) REFERENCES keyword_record(id,client_organization_id,project_id),
  CHECK(period_end IS NULL OR period_start IS NULL OR period_end>=period_start)
);

CREATE TABLE keyword_review_package_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id),
  dataset_id UUID NOT NULL, version INTEGER NOT NULL CHECK(version>=1), status TEXT NOT NULL CHECK(status IN ('OPEN','COMPLETED')),
  submitted_by_user_id UUID NOT NULL REFERENCES "user"(id), submitted_at TIMESTAMPTZ NOT NULL,
  UNIQUE(dataset_id,version), UNIQUE(id,client_organization_id,project_id),
  FOREIGN KEY(dataset_id,client_organization_id,project_id) REFERENCES keyword_dataset(id,client_organization_id,project_id)
);
CREATE TABLE keyword_review_package_item_v2 (
  client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id), review_package_id UUID NOT NULL,
  keyword_record_id UUID NOT NULL, position INTEGER NOT NULL CHECK(position>=0), PRIMARY KEY(review_package_id,keyword_record_id), UNIQUE(review_package_id,position),
  FOREIGN KEY(review_package_id,client_organization_id,project_id) REFERENCES keyword_review_package_v2(id,client_organization_id,project_id),
  FOREIGN KEY(keyword_record_id,client_organization_id,project_id) REFERENCES keyword_record(id,client_organization_id,project_id)
);
CREATE TABLE keyword_decision_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_organization_id UUID NOT NULL REFERENCES organization(id), project_id UUID NOT NULL REFERENCES project(id),
  review_package_id UUID NOT NULL, keyword_record_id UUID NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('CONFIRMED','CHANGES_REQUESTED','REJECTED')),
  reviewer_user_id UUID NOT NULL REFERENCES "user"(id), note TEXT, decided_at TIMESTAMPTZ NOT NULL,
  UNIQUE(review_package_id,keyword_record_id), FOREIGN KEY(review_package_id,client_organization_id,project_id) REFERENCES keyword_review_package_v2(id,client_organization_id,project_id),
  FOREIGN KEY(keyword_record_id,client_organization_id,project_id) REFERENCES keyword_record(id,client_organization_id,project_id),
  CHECK(decision='CONFIRMED' OR length(trim(coalesce(note,'')))>0)
);

CREATE INDEX ix_keyword_dataset_scope ON keyword_dataset(client_organization_id,project_id);
CREATE INDEX ix_keyword_record_dataset ON keyword_record(client_organization_id,project_id,dataset_id);
CREATE INDEX ix_demand_evidence_record ON demand_evidence(client_organization_id,project_id,keyword_record_id);
COMMIT;
