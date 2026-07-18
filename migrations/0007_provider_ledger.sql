-- ============================================================================
-- Migration: 0007_provider_ledger
-- Checkpoint: PROVIDER_EXECUTION_LEDGER_V1 (Agent D / runtime/controlled-provider)
--
-- Scope: durable, tenant+project-scoped persistence for the controlled-provider
--   boundary's observability records (src/runtime/provider/records.ts) — one
--   append-only `provider_execution` row per real provider call. Fed by the D3
--   PgProviderLedger (src/runtime/provider/pg-provider-ledger.ts), which the D2
--   OpenAI-compatible adapter emits to through its non-secret record observer.
--
-- Tenancy: every row is tenant-scoped (client_organization_id NOT NULL, real FK
--   to organization) AND project-scoped (project_id NOT NULL, real FK to
--   project). This migration foreign-keys out to ONLY 0001's organization(id)
--   and project(id). It does not alter any 0001-0006 object.
--
-- Non-FK id reference: article_brief_id is a plain UUID column, NOT a foreign
--   key. The ArticleBrief aggregate lives in a different lane's tables (0004)
--   and the provider boundary is deliberately decoupled from it — a provider
--   call may be recorded for a brief id whose row is out of this lane's scope.
--   Same deliberate "polymorphic reference to an out-of-scope module" pattern
--   0001 uses for artifact_index.artifact_id and 0003 uses for its grounding_*
--   / industry_profile_id columns.
--
-- ####################################################################### --
-- ## CRITICAL — NO SECRETS, NO RAW CONTENT, EVER (SYSTEM_INVARIANTS_V1). ## --
-- ####################################################################### --
--   This table stores ONLY non-secret operational facts: correlation/idempotency
--   identifiers, tenant/project/brief scope, the model name, an outcome, a
--   taxonomy error code, token COUNTS, and latency. There is deliberately:
--     * NO api_key / bearer / authorization / credential column, and
--     * NO prompt / response / message / content text column.
--   The raw provider request and completion text are NEVER persisted here — only
--   the token counts and metadata survive. A row can be dumped or logged
--   wholesale without leaking a secret or any customer/model content, because
--   there is nowhere in the shape to put one. (The record types this table is
--   fed from, records.ts, have the same property by construction.)
--
-- Append-only (docs/governance/SYSTEM_INVARIANTS_V1.md, "historical artifacts
--   are never mutated"): a recorded provider execution is history and may never
--   be edited in place or deleted. UPDATE and DELETE are forbidden at the
--   database level by triggers (same pattern as 0001's artifact_index and 0003's
--   append-only history tables), so a bug or a compromised app-tier credential
--   cannot silently rewrite the ledger.
--
-- Idempotency: idempotency_key is UNIQUE, so re-emitting the same logical call
--   (a retry, a duplicated observer emission, an at-least-once delivery) yields
--   exactly ONE row. The repository inserts with ON CONFLICT DO NOTHING against
--   this key — a subsequent INSERT for the same key is a no-op, not an UPDATE,
--   so it never trips the append-only triggers above.
--
-- Outcome coherence: an OK row structurally carries token counts and no error
--   code; an ERROR row structurally carries a taxonomy error code and no token
--   counts. This mirrors records.ts, where a success execution record embeds a
--   usage record (tokens) with a null errorCode, and a failure execution record
--   carries a taxonomy code with a null usage.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- provider_execution  (APPEND-ONLY; NO SECRETS; NO RAW CONTENT)
-- One record per controlled-provider call. "usage" is captured as the token
-- COUNT columns on an OK row; "failure" is captured as error_code on an ERROR
-- row — there is exactly one row per execution.
-- ----------------------------------------------------------------------------
CREATE TABLE provider_execution (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Correlation id for this specific call (tracing). Non-secret.
  request_id               TEXT NOT NULL,
  -- Idempotency key — same key must map to exactly one row (unique below).
  idempotency_key          TEXT NOT NULL,
  project_id               UUID NOT NULL REFERENCES project(id),
  client_organization_id   UUID NOT NULL REFERENCES organization(id),
  -- Not a FK: the ArticleBrief aggregate is out of this lane's scope (see header).
  article_brief_id         UUID NOT NULL,
  -- The model identifier sent verbatim to the provider. Non-secret metadata.
  model                    TEXT NOT NULL,
  -- OK | ERROR  (mirrors ProviderExecutionRecord.outcome).
  status                   TEXT NOT NULL,
  -- One of the 7 provider taxonomy codes (errors.ts), or NULL on success.
  error_code               TEXT NULL,
  -- Token COUNTS only — never the prompt or completion text. NULL on an ERROR row.
  prompt_tokens            INTEGER NULL,
  completion_tokens        INTEGER NULL,
  total_tokens             INTEGER NULL,
  latency_ms               INTEGER NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_provider_execution_request_id_not_blank
    CHECK (length(trim(request_id)) > 0),
  CONSTRAINT ck_provider_execution_idempotency_key_not_blank
    CHECK (length(trim(idempotency_key)) > 0),
  CONSTRAINT ck_provider_execution_model_not_blank
    CHECK (length(trim(model)) > 0),
  CONSTRAINT ck_provider_execution_status
    CHECK (status IN ('OK', 'ERROR')),
  -- error_code, when present, is exactly one of the 7 closed taxonomy codes.
  CONSTRAINT ck_provider_execution_error_code
    CHECK (
      error_code IS NULL OR error_code IN (
        'PROVIDER_TIMEOUT',
        'PROVIDER_RATE_LIMIT',
        'PROVIDER_AUTH_FAILED',
        'PROVIDER_CONTRACT_INVALID',
        'PROVIDER_EMPTY_RESPONSE',
        'PROVIDER_TOKEN_LIMIT',
        'PROVIDER_UNAVAILABLE'
      )
    ),
  CONSTRAINT ck_provider_execution_tokens_nonneg
    CHECK (
      (prompt_tokens IS NULL OR prompt_tokens >= 0)
      AND (completion_tokens IS NULL OR completion_tokens >= 0)
      AND (total_tokens IS NULL OR total_tokens >= 0)
    ),
  CONSTRAINT ck_provider_execution_latency_nonneg
    CHECK (latency_ms >= 0),
  -- The load-bearing coherence invariant: an OK row carries token counts and no
  -- error; an ERROR row carries a taxonomy code and no token counts. A
  -- half-formed row (OK with an error code, ERROR with tokens, OK missing its
  -- totals) is unrepresentable.
  CONSTRAINT ck_provider_execution_outcome
    CHECK (
      (status = 'OK'
         AND error_code IS NULL
         AND prompt_tokens IS NOT NULL
         AND completion_tokens IS NOT NULL
         AND total_tokens IS NOT NULL
         AND total_tokens = prompt_tokens + completion_tokens)
      OR
      (status = 'ERROR'
         AND error_code IS NOT NULL
         AND prompt_tokens IS NULL
         AND completion_tokens IS NULL
         AND total_tokens IS NULL)
    ),
  -- Idempotency: exactly one row per logical call.
  CONSTRAINT uq_provider_execution_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX ix_provider_execution_client_org ON provider_execution(client_organization_id);
CREATE INDEX ix_provider_execution_project ON provider_execution(project_id);
CREATE INDEX ix_provider_execution_article_brief ON provider_execution(article_brief_id);
CREATE INDEX ix_provider_execution_request_id ON provider_execution(request_id);
CREATE INDEX ix_provider_execution_created_at ON provider_execution(created_at);

-- Append-only: a recorded provider execution is history and may never be edited
-- in place or deleted. Same DB-level guarantee as 0001's artifact_index (not
-- merely an application convention).
CREATE OR REPLACE FUNCTION provider_execution_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'provider_execution is append-only: % is not permitted (SYSTEM_INVARIANTS_V1.md)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_provider_execution_forbid_update
  BEFORE UPDATE ON provider_execution
  FOR EACH ROW EXECUTE FUNCTION provider_execution_forbid_mutation();

CREATE TRIGGER trg_provider_execution_forbid_delete
  BEFORE DELETE ON provider_execution
  FOR EACH ROW EXECUTE FUNCTION provider_execution_forbid_mutation();

COMMIT;
