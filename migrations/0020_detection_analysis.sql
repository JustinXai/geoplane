-- MVP Detection Analysis — simplified brand-matching observation table.
-- DetectionTask / DetectionRun tables are produced by Agent P's detection-run lane.

BEGIN;

CREATE TABLE detection_observation (
  id UUID PRIMARY KEY,
  detection_task_id UUID NOT NULL REFERENCES detection_task(id),
  run_id UUID NOT NULL REFERENCES detection_run(id),
  platform TEXT NOT NULL,
  question TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  brand_mentioned BOOLEAN NOT NULL,
  matched_brand_terms TEXT[] NOT NULL DEFAULT '{}',
  brand_mention_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_detection_observation_run ON detection_observation(run_id);
CREATE INDEX ix_detection_observation_task ON detection_observation(detection_task_id);

COMMIT;
