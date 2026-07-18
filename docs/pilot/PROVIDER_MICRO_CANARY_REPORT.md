# PROVIDER_MICRO_CANARY_REPORT

`SANITIZED_PROVIDER_MICRO_CANARY_V1` — the single controlled real-model call.

Records ONLY non-secret facts: no API key, no Authorization header, no full prompt, no full
response. The provider key was supplied by the operator in a gitignored `.env.local` and was never
read, echoed, logged, committed, or persisted by this run.

## Result

| Field | Value |
|---|---|
| Time (ledger created_at) | 2026-07-18 22:12:46 +08:00 |
| Model | `deepseek-v4-flash` |
| Gateway vendor (canonical identity) | `ALIYUN_MAAS` — the call went through the Aliyun MaaS OpenAI-compatible gateway, NOT the DeepSeek-direct API |
| Model vendor (canonical identity) | `DEEPSEEK` |
| Protocol (canonical identity) | `OPENAI_COMPATIBLE` |
| Provider base URL host | `ws-…maas.aliyuncs.com` (operator-configured; elided — the full host is never persisted) |
| Real Network Calls | **1** (fetch-guarded; a 2nd request is refused without network I/O) |
| Provider Result | **PASS** |
| Provider Error Code | none |
| Provider Contract Validation | **PASS** (governance firewall) |
| Governance Field Leak Count | **0** |
| Prompt Tokens | 152 |
| Completion Tokens | 490 |
| Total Tokens | 642 |
| Latency (ms) | 5901 |
| Provider Ledger Rows Added | **1** |
| Provider Ledger Row ID | `24ae04dc-7798-42be-a27f-14bd8d93deb0` |
| Provider Ledger Append-only | **PASS** (UPDATE + DELETE both rejected) |
| Secret Persisted | **NO** (no api_key/token/secret column exists) |
| Raw Prompt Persisted | **NO** |
| Raw Response Persisted | **NO** |
| Automatic Human Review | **NO** |
| Automatic Article Approval | **NO** (0 approvals) |
| PublishPackage Created | **NO** |
| PublicationReceipt Created | **NO** (0 receipts) |
| Automatic Publication | **NO** |
| Default Selected Channel Count | **0** |
| Real Customer Data Used | **0** (fully desensitized org/project; request carries only IDs + a fixed sanitized system prompt) |

## How it ran

- Test: `tests/pilot/provider-micro-canary.canary.test.ts` — skipped in `npm test` (guarded by
  `RUN_PROVIDER_CANARY`), so the normal suite never makes a real call.
- Runner: `scripts/provider/micro-canary.mjs` — validates the environment (rejects a stale
  `PROVIDER_API_KEY`, requires a test/pilot/canary database, refuses the production runtime db,
  requires `deepseek-v4-flash`), then runs the single canary via vitest with the flag ON **only for
  that subprocess**. `PROVIDER_RUNTIME_ENABLED` stays `false` in every `.env.local`.
- Database: a throwaway `geoplane_canary` database (migrations 0001–0007 applied).
- The real adapter (`OpenAICompatibleProviderAdapter`) + real ledger (`PgProviderLedger`) were used
  unchanged; the key lives only transiently in the outbound request header, never in a record/log.
- Canonical Provider Identity (`src/runtime/provider/identity.ts`, added by
  `PROVIDER_IDENTITY_LEDGER_V1`): this call was a `DEEPSEEK` model through the `ALIYUN_MAAS`
  gateway over the `OPENAI_COMPATIBLE` protocol. Earlier prose describing it as a "DeepSeek direct
  API" call was inaccurate and has been corrected. The ledger row above predates migration
  `0008_provider_identity.sql`, so after the DDL backfill it reads `gateway_vendor =
  'UNKNOWN_LEGACY'` (backfill-only marker; the row itself is never mutated by hand) — any FUTURE
  canary row carries `ALIYUN_MAAS` / `DEEPSEEK` / `OPENAI_COMPATIBLE` declared as adapter config.

## Verdict

`PROVIDER_MICRO_CANARY_GATE = PASS`. Remaining environment gate: `POSTGRESQL_16_VERIFY`.
