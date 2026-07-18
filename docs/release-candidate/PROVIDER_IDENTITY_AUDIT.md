# PROVIDER_IDENTITY_AUDIT — Closed Pilot RC Supervisor Audit

- Phase: `CLOSED_PILOT_RELEASE_CANDIDATE_V1` / `CLOSED_PILOT_RC_SUPERVISOR_AUDIT_V1`
- Audited tree: `audit/closed-pilot-rc-supervisor-v1` after merging `integration/closed-pilot-rc-v1` (93ad2798180315e826f4d5b4bf6a93669d084db5; baseline b31c2cd)
- Method: static code / migration / git-history / docs review only. No test suite run, no DB touched, no provider call, no secret printed.
- Date: 2026-07-18

## Scope

Checklist items 1 (gateway identity accuracy), 2 (ledger leak check), 4 (real call count still 1),
part of 9 (provider_execution append-only after 0008).

## Item 1 — Provider gateway identity accurate: ALIYUN_MAAS, DEEPSEEK, OPENAI_COMPATIBLE

**Verdict: PASS**

| Surface | Evidence |
| --- | --- |
| Identity contract | `src/runtime/provider/identity.ts:36-46` — closed enums `ProviderGatewayVendor` (`DEEPSEEK_DIRECT`, `ALIYUN_MAAS`, `CUSTOM_OPENAI_COMPATIBLE`, `UNKNOWN_LEGACY`), `ProviderModelVendor` (`DEEPSEEK`, `OPENAI`, `OTHER`), `ProviderProtocol` (`OPENAI_COMPATIBLE` only). |
| Default identity | `identity.ts:87-91` — `DEFAULT_PROVIDER_IDENTITY = { gatewayVendor: "ALIYUN_MAAS", modelVendor: "DEEPSEEK", protocol: "OPENAI_COMPATIBLE" }`, with docstring (lines 82-86) explicitly correcting the earlier "DeepSeek direct" mislabel. |
| UNKNOWN_LEGACY containment | `identity.ts:119-127` — `assertRuntimeProviderIdentity` throws if a runtime adapter is configured with `UNKNOWN_LEGACY` (backfill-only marker). Enforced at adapter construction: `openai-compatible-adapter.ts:287-289`. |
| Adapter | `src/runtime/provider/openai-compatible-adapter.ts:96-102,146-154` — identity is DECLARED configuration, never derived from `PROVIDER_BASE_URL`; default is `DEFAULT_PROVIDER_IDENTITY` (Aliyun MaaS). |
| Canary runner | `scripts/provider/micro-canary.mjs:14-18,75` — prints and documents canonical identity gateway ALIYUN_MAAS / model vendor DEEPSEEK / protocol OPENAI_COMPATIBLE. |
| Canary test | `tests/pilot/provider-micro-canary.canary.test.ts:113-118` declares `gatewayVendor: "ALIYUN_MAAS"` on the adapter; line 176 asserts the persisted row's `gateway_vendor === "ALIYUN_MAAS"`. |
| Migration | `migrations/0008_provider_identity.sql:65-76` — CHECK constraints mirror the closed enum sets exactly. |
| Docs | `docs/pilot/PROVIDER_MICRO_CANARY_REPORT.md:15` ("`ALIYUN_MAAS` … NOT the DeepSeek-direct API"), lines 54-59 (identity correction addendum). |
| No stale claims | Repo-wide grep for "DeepSeek direct" (case-insensitive): every hit is either the corrective prose above, an adapter docstring noting a DeepSeek-direct endpoint *would speak the same protocol*, or a ledger test persisting a hypothetical non-default identity (`tests/runtime/provider/provider-ledger.pg.test.ts:274`). No file claims the real canary was DeepSeek-direct. |

Note: `DEEPSEEK_DIRECT` remains a legal enum member for possible future integrations; it is never
used as a default and never asserted as the historical fact anywhere.

## Item 2 — Ledger leak check: no endpoint host / base URL / workspace id / key / prompt / response

**Verdict: PASS**

- `migrations/0007_provider_ledger.sql:66-139` — `provider_execution` column set is exactly: `id, request_id, idempotency_key, project_id, client_organization_id, article_brief_id, model, status, error_code, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at`. Header lines 24-36 state the prohibition explicitly.
- `migrations/0008_provider_identity.sql:55-61` adds only `gateway_vendor`, `model_vendor`, `protocol` (three closed-enum TEXT columns); header lines 17-29 explicitly state NO base_url/endpoint/host, NO workspace_id, NO api_key/bearer/authorization, NO prompt/response/content column.
- `src/runtime/provider/records.ts:30-88` — `ProviderUsageRecord`, `ProviderExecutionRecord`, `ProviderFailureRecord`, `ProviderCallMetadata` have no field for any of the forbidden values (only ids, model, identity enums, token counts, latency, taxonomy code).
- `src/runtime/provider/pg-provider-ledger.ts:198-225` — the INSERT names exactly the whitelisted columns; identity is passed as the three enum strings (lines 214-217).
- Structured logging: `src/runtime/observability/logger.ts:27-40` fixed allowlisted field set (requestId/actor ids/org ids/route/status/latencyMs/errorCode); lines 77-99 forbidden-key redaction patterns (api key, authorization, bearer, secret, prompt, completion, provider response, raw/content text, …); lines 173-189 allowlist projection so an unknown top-level field is never emitted.
- Tests enforce the whitelist: `tests/runtime/provider/provider-ledger.pg.test.ts:157-190` asserts the exact `information_schema.columns` set (equality — any extra column fails) and lines 188-222 assert a defense-in-depth forbidden-name set is absent; `tests/runtime/provider/provider-identity-migration.pg.test.ts:201-215` asserts the three identity columns exist NOT NULL with defaults dropped.

Minor observation (non-persisted, not a violation): `scripts/provider/micro-canary.mjs:76` prints
the `PROVIDER_BASE_URL` **host** to the operator console at run time. This is transient stdout of a
manually-invoked ops script — it is never written to any record, ledger row, or structured log, and
a hostname is not a credential — but removing the line would make the "endpoint host appears
nowhere" property absolute. Recommended cleanup, not a blocker.

## Item 4 — Real provider call count still exactly 1

**Verdict: PASS**

- Canary is skip-gated: `tests/pilot/provider-micro-canary.canary.test.ts:27` (`RUN = process.env.RUN_PROVIDER_CANARY === "true"`), line 59 (`describe.skipIf(!RUN || canaryConfig === null)`). `RUN_PROVIDER_CANARY` is set ONLY by `scripts/provider/micro-canary.mjs:84`; `package.json:11` `"test": "vitest run"` sets nothing, so `npm test` can never run the canary.
- Single-call guard inside the canary: `provider-micro-canary.canary.test.ts:106` — the fetch wrapper rejects "refusing a second real network call"; line 143 asserts exactly one real network call.
- No new real-call sites: repo grep for `globalThis.fetch` in `src/` finds only `src/runtime/provider/openai-compatible-adapter.ts:441` (flag-gated at lines 307-312 via `assertRealProviderCallAllowed` before any I/O) and `src/lib/api-client/http.ts:158` (the app's own same-origin API client — not a provider call). The offline adapter (`deterministic-offline-adapter.ts:8`) has zero network imports.
- Every committed test that sets `PROVIDER_RUNTIME_ENABLED: "true"` injects a fake fetch AND spies the global fetch to assert it is never reached: `tests/runtime/provider/openai-adapter.test.ts:4-5,209-214`; `tests/runtime/provider/provider-ledger.pg.test.ts:485-496`.
- `PROVIDER_RUNTIME_ENABLED` is not globally enabled anywhere committed: the only tracked env file is `.env.example` (does not set the flag); `.gitignore:10-12` excludes `.env` / `.env.*` except `.env.example`. `scripts/preflight/preflight.mjs:102` WARNs if the flag is ever found true in staging. Default-OFF semantics: `src/runtime/provider/feature-flag.ts:35-41` (only `"true"`/`"1"` enable; everything else OFF).
- The E ops suite re-proves at run time that the flag is OFF and that the whole ledger contains exactly one row naming only `"offline-deterministic"` — never a real model: `tests/pilot/closed-pilot-operations.e2e.pg.test.ts:1469-1482`.
- Frozen fact cross-check: `docs/pilot/PROVIDER_MICRO_CANARY_REPORT.md` records the single sanitized micro canary (model `deepseek-v4-flash`, gateway ALIYUN_MAAS); the canary runner refuses any model other than `deepseek-v4-flash` (`micro-canary.mjs:68-69`).

## Item 9 (provider slice) — provider_execution append-only after 0008

**Verdict: PASS**

- `migrations/0007_provider_ledger.sql:150-162` — `provider_execution_forbid_mutation()` + BEFORE UPDATE / BEFORE DELETE triggers.
- `migrations/0008_provider_identity.sql` contains only `ALTER TABLE … ADD COLUMN / ADD CONSTRAINT / DROP DEFAULT`; repo-wide grep for `DROP TRIGGER` / `DISABLE TRIGGER` across `migrations/`, `scripts/`, `src/` returns nothing. The 0008 backfill is a DDL default (lines 52-61), never a row-level UPDATE, so triggers were never disabled.
- Tests: `tests/runtime/provider/provider-identity-migration.pg.test.ts:378` asserts the identity columns are immutable post-0008; `tests/pilot/closed-pilot-operations.e2e.pg.test.ts:1447-1459` re-asserts UPDATE and DELETE are refused (`/append-only/i`) on the history tables including the provider ledger.

## Overall verdict for this document

**PASS** — provider identity is accurately ALIYUN_MAAS / DEEPSEEK / OPENAI_COMPATIBLE everywhere it
matters; the ledger and logging shapes structurally cannot carry a secret, endpoint host, workspace
id, or content; the real-call count remains exactly 1 with no committed path to a second; the ledger
stays append-only after 0008. One optional cleanup noted (canary runner's console print of the base
URL host).
