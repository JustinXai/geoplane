-- ============================================================================
-- Migration: 0008_provider_identity
-- Checkpoint: PROVIDER_IDENTITY_LEDGER_V1 (Agent B / runtime/controlled-provider)
--
-- Scope: adds the Canonical Provider Identity (src/runtime/provider/identity.ts)
--   to the append-only `provider_execution` ledger (0007). The one real canary
--   call went through the Aliyun MaaS gateway to a DeepSeek model over the
--   OpenAI-compatible protocol; the ledger previously recorded only the model
--   string, which conflates three orthogonal facts. This migration makes each
--   fact a first-class column with a closed-enum CHECK constraint:
--     * gateway_vendor - WHICH GATEWAY terminated the HTTPS request,
--     * model_vendor   - WHOSE MODEL produced the completion,
--     * protocol       - WHICH WIRE PROTOCOL the call spoke.
--   This migration alters ONLY provider_execution. No 0001-0007 object is
--   touched, and the 0007 append-only triggers remain fully in force.
--
-- ####################################################################### --
-- ## CRITICAL - NO SECRETS, NO RAW CONTENT, EVER (SYSTEM_INVARIANTS_V1). ## --
-- ####################################################################### --
--   The identity is DECLARED configuration (three closed-enum strings), never
--   derived from the endpoint. There is deliberately:
--     * NO base_url / endpoint / host column,
--     * NO workspace_id column,
--     * NO api_key / bearer / authorization / credential column, and
--     * NO prompt / response / message / content text column.
--   A row can still be dumped or logged wholesale without leaking a secret or
--   any endpoint/workspace detail, because there is nowhere in the shape to
--   put one. (The ProviderIdentity type this table is fed from, identity.ts,
--   has the same property by construction.)
--
-- Backfill without mutation (append-only stays intact): historical rows were
--   recorded before the identity contract existed, so their gateway cannot be
--   asserted after the fact - they are backfilled as gateway_vendor
--   'UNKNOWN_LEGACY' (a backfill-only marker the runtime never writes for a
--   new call), model_vendor 'DEEPSEEK' and protocol 'OPENAI_COMPATIBLE' (both
--   true of every historical row: only DeepSeek models over the
--   OpenAI-compatible protocol were ever callable). The backfill uses
--   ADD COLUMN ... NOT NULL DEFAULT, which rewrites/annotates the table via
--   DDL and does NOT execute a row-level UPDATE - so the 0007 append-only
--   UPDATE trigger is never tripped and never needs to be disabled.
--
-- Defaults are then DROPPED: the DDL default exists solely as the one-time
--   backfill vehicle. After this migration an INSERT must declare all three
--   identity columns explicitly (the adapter carries them as configuration),
--   so a writer can never silently mint a legacy-looking row.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- provider_execution: add the canonical identity columns.
-- ADD COLUMN ... NOT NULL DEFAULT backfills every existing row via DDL
-- (no row-level UPDATE, so the append-only triggers stay untripped and intact).
-- ----------------------------------------------------------------------------
ALTER TABLE provider_execution
  -- WHICH GATEWAY terminated the HTTPS request. Backfill: unknown for history.
  ADD COLUMN gateway_vendor TEXT NOT NULL DEFAULT 'UNKNOWN_LEGACY',
  -- WHOSE MODEL produced the completion. Backfill: only DeepSeek models were ever callable.
  ADD COLUMN model_vendor   TEXT NOT NULL DEFAULT 'DEEPSEEK',
  -- WHICH WIRE PROTOCOL the call spoke. Backfill: only OpenAI-compatible existed.
  ADD COLUMN protocol       TEXT NOT NULL DEFAULT 'OPENAI_COMPATIBLE';

-- Closed enum sets - mirrors identity.ts exactly (one source of truth,
-- asserted by tests/runtime/provider/provider-ledger.pg.test.ts).
ALTER TABLE provider_execution
  ADD CONSTRAINT ck_provider_execution_gateway_vendor
    CHECK (gateway_vendor IN (
      'DEEPSEEK_DIRECT',
      'ALIYUN_MAAS',
      'CUSTOM_OPENAI_COMPATIBLE',
      'UNKNOWN_LEGACY'
    )),
  ADD CONSTRAINT ck_provider_execution_model_vendor
    CHECK (model_vendor IN ('DEEPSEEK', 'OPENAI', 'OTHER')),
  ADD CONSTRAINT ck_provider_execution_protocol
    CHECK (protocol IN ('OPENAI_COMPATIBLE'));

-- The defaults were the one-time backfill vehicle only. Drop them so every
-- future INSERT must declare the identity explicitly (it is adapter
-- configuration, never an implicit column default).
ALTER TABLE provider_execution
  ALTER COLUMN gateway_vendor DROP DEFAULT,
  ALTER COLUMN model_vendor   DROP DEFAULT,
  ALTER COLUMN protocol       DROP DEFAULT;

COMMIT;
