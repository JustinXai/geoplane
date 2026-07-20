BEGIN;

CREATE TABLE detection_run (
  id UUID PRIMARY KEY,
  client_organization_id UUID NOT NULL REFERENCES organization(id),
  project_id UUID NOT NULL REFERENCES project(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','MANUAL_REQUIRED')),
  questions JSONB NOT NULL,
  platforms TEXT[] NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detection_task (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES detection_run(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','MANUAL_REQUIRED')),
  answer_text TEXT,
  failure_code TEXT,
  failure_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_detection_run_scope ON detection_run(client_organization_id, project_id);
CREATE INDEX ix_detection_task_run ON detection_task(run_id);

COMMIT;
