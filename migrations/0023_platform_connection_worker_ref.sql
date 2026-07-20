-- Migration: 0023_platform_connection_worker_ref
-- Adds worker_session_ref field to track worker session references

ALTER TABLE platform_connection 
ADD COLUMN IF NOT EXISTS worker_session_ref TEXT;

COMMENT ON COLUMN platform_connection.worker_session_ref IS 
'JSON reference to worker session state for reconnection/resume';

CREATE INDEX IF NOT EXISTS ix_platform_connection_worker_ref 
ON platform_connection(worker_session_ref) 
WHERE worker_session_ref IS NOT NULL;
