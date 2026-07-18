# PROVIDER BOUNDARY AUDIT — controlled provider (flag OFF)

Read-only supervisor audit at pilot HEAD `3d2da9c`. Scope: the controlled-provider boundary —
feature flag, contract-validation firewall, real adapter, and execution ledger (migration
0007). This audit found **0 REAL violations**.

Corroboration: `tests/runtime/provider/*` (contract-validation, feature-flag, offline-adapter,
openai-adapter, port-and-taxonomy) and `provider-ledger.pg.test.ts` were executed and **all
pass**; `tsc --noEmit` is clean. `.env.local` sets `PROVIDER_RUNTIME_ENABLED=false`.

---

## 1. Can a real call bypass the feature flag (`PROVIDER_RUNTIME_ENABLED`)? — **NO**

- Default-OFF: `isProviderRuntimeEnabled` returns `false` for anything but an explicit
  `"true"`/`"1"` (case-insensitive) — `src/runtime/provider/feature-flag.ts:35-41`.
- `assertRealProviderCallAllowed` throws `ProviderRuntimeDisabledError`
  (`PROVIDER_UNAVAILABLE`) when the flag is off — `src/runtime/provider/feature-flag.ts:71-77`.
- The real adapter calls the guard **before any network I/O**; a disabled runtime returns a
  `PROVIDER_UNAVAILABLE` result and never opens a socket —
  `src/runtime/provider/openai-compatible-adapter.ts:277-282`.
- The offline deterministic adapter makes no network call and is safe to run as the default
  while the flag is off — `src/runtime/provider/feature-flag.ts:61-68`.
- **Defence in depth**: the real `OpenAICompatibleProviderAdapter` is **not instantiated
  anywhere in non-test `src/`** (grep: only its own `export class` declaration and test
  files). There is no reachable production route that issues a live provider call even if the
  flag were flipped — the flag-on path is exercised only by tests and awaits a deliberate
  wiring + operator key (see the micro-canary env gate below).

Verified by `tests/runtime/provider/feature-flag.test.ts`,
`.../offline-adapter.test.ts`, `.../openai-adapter.test.ts` (all pass).

## 2. Can the model produce governance / gate / approval / hash / publication? — **NO (contract-validation firewall)**

`validateProviderContent` is the gate every completion passes before it can become content:

- **Governance firewall runs first** and deep-walks the whole object graph (depth-bounded),
  rejecting any governance **key** fragment (`gate`, `approv`, `reviewer`, `status`, `publish`,
  `publication`, `channel`, `evidencehash`, `eventhash`, `*hash`, `sealed`, `validation`, …)
  and any governance **value** literal (`APPROVED`, `PUBLISHED`, `SEALED`, `PASSED`,
  `PLATFORM_WIDE_GATE`, …) as `PROVIDER_CONTRACT_INVALID` —
  `src/runtime/provider/contract-validation.ts:43-134`, `165-169`.
- Then a strict **whitelist**: only `schemaVersion|title|summary|sections` at top level and
  `heading|body` per section; unknown keys are rejected —
  `src/runtime/provider/contract-validation.ts:94-103`, `171-208`.
- The return type `ProviderResult → ProviderArticleContentV1` **structurally forbids**
  governance; governance is injected deterministically downstream by Stage 2, never by the
  model — `src/runtime/provider/contract-validation.ts:7-25`.
- The real adapter forces **every** completion through this firewall before returning content
  — `src/runtime/provider/openai-compatible-adapter.ts:487-491`. The system prompt is a
  best-effort nudge, not the boundary — `.../openai-compatible-adapter.ts:106-116`.

Verified by `tests/runtime/provider/contract-validation.test.ts` and
`.../port-and-taxonomy.test.ts` (pass).

## 3. Can the provider auto-approve or auto-publish? — **NO**

The adapter only requests Stage-1 user-visible content (`generateArticleContent`); its output
type carries no approval/publish field, and any such field in a completion is rejected by §2.
No approval or publication decision exists anywhere in `src/runtime/provider/**` — the
boundary emits infrastructure facts only (records.ts), not business verdicts —
`src/runtime/provider/records.ts:16-19`.

## 4. Can the API key leak into a record / log / error / ledger row? — **NO**

- The key is read lazily into a **transient per-call local**, used **only** to build the
  outbound HTTP authorization request header, and is never assigned to an instance field, a
  record, a log line, or an error — `src/runtime/provider/openai-compatible-adapter.ts:11-37`,
  `293-296`, `415-424`. The adapter performs no logging.
- The observability record shapes have **no field** for a key/token/credential or for raw
  prompt/response text — `src/runtime/provider/records.ts:9-20` (whole file). `promptTokens`
  etc. are integer **counts**, not text.
- The ledger writes only the record's non-secret fields and derives the tenant authoritatively
  from the owning `project` row (never from the record) —
  `src/runtime/provider/pg-provider-ledger.ts:11-33`, `160-205`.
- Migration `0007_provider_ledger.sql` has **no** `api_key`/`bearer`/`authorization`/
  `credential` column and **no** `prompt`/`response`/`message`/`content` text column — only
  correlation ids, tenant/project/brief scope, model name, outcome, taxonomy error code, token
  **counts**, latency — `migrations/0007_provider_ledger.sql:24-36`, `66-139`. The table is
  **append-only** (UPDATE/DELETE forbidden by triggers) and idempotent on `idempotency_key`
  (`ON CONFLICT DO NOTHING`, one row per call) — `migrations/0007_provider_ledger.sql:45-49`,
  `137-162`.

A targeted grep of `src/runtime/provider/**` + `0007` for secret-shaped columns/fields found
only: the transient `apiKey` local + its single header use, and token-**count** columns.
Verified by `tests/runtime/provider/provider-ledger.pg.test.ts` (pass — secret-free,
tenant-scoped, one-row-per-execution).

## 5. Additional safety limits (adapter)

Single `max_tokens` cap, single per-attempt timeout, at most one retry (429/5xx only,
sequential — no concurrency storm), and **never auto-switch model** (a model not in the
allow-list is rejected, the request model sent verbatim) —
`src/runtime/provider/openai-compatible-adapter.ts:20-32`, `287-330`, `374-387`.

---

## Env gate (not a build failure)

**Provider live micro-canary — BLOCKED_PENDING_OPERATOR.** The flag-on path is fully built and
unit-covered offline, but a real end-to-end micro-canary requires a real provider API key in
the deploy environment and a deliberate wiring of the adapter into a route. This is a
KNOWN-ENV-GATE, to be run by the operator once a key is provisioned — not a defect of the
build.

## Verdict — PROVIDER BOUNDARY: PASS (0 REAL violations)

Flag is default-OFF and unbypassable (and the real adapter is not even wired into a reachable
path); the contract-validation firewall structurally and at runtime forbids
governance/approval/publication; the API key cannot reach any record, log, error, or ledger
row by construction. One operator-env gate (live micro-canary) remains.
