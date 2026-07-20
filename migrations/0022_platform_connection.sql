CREATE TABLE platform_connection (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES project(id),
  account_id UUID NOT NULL REFERENCES account(id),
  platform TEXT NOT NULL,
  worker_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, platform)
);

CREATE INDEX ix_platform_connection_project ON platform_connection(project_id);
