# ENVIRONMENT_CONFIGURATION_AUDIT — Closed Pilot RC Supervisor Audit

- Phase: `CLOSED_PILOT_RELEASE_CANDIDATE_V1` / `CLOSED_PILOT_RC_SUPERVISOR_AUDIT_V1`
- Audited tree: `audit/closed-pilot-rc-supervisor-v1` after merging `integration/closed-pilot-rc-v1` (93ad2798180315e826f4d5b4bf6a93669d084db5; baseline b31c2cd)
- Method: static review only (code, migrations, docs, git history). No test run, no DB connection, no secret printed.
- Date: 2026-07-18

## Scope

Checklist item 3 (Runtime/Test/Canary DB separation), item 10 (no secrets in the committed tree),
plus the environment-facing half of item 4 (flag never globally enabled — see also
PROVIDER_IDENTITY_AUDIT.md).

## Item 3 — Three DB environment roles, canary refusal, test-TRUNCATE containment, preflight taxonomy

**Verdict: PASS_WITH_CHANGES** (one defense-in-depth recommendation; primary controls all present)

### 3a. Three roles distinct — PASS

- `src/persistence/config.ts:30-41` — `DatabaseEnvironmentRole = "runtime" | "test" | "canary"` mapped to `GEO_DATABASE_URL` / `GEO_TEST_DATABASE_URL` / `GEO_CANARY_DATABASE_URL`; `loadDatabaseConfigForRole` (lines 95-98).
- `.env.example` (tracked template) documents all three roles with `CHANGE_ME` placeholders only and the isolation rules verbatim.
- `docs/pilot/DATABASE_ENVIRONMENT_ROLES.md:12-25` — operator-facing statement of the same rules.

### 3b. Canary runner refuses runtime/test targets — PASS

- `scripts/provider/micro-canary.mjs:55-65` — reads ONLY `GEO_CANARY_DATABASE_URL` (no fallback; aborts if unset), requires the db name to contain `canary` (line 59), and aborts if the canary target equals the runtime OR test target compared by host+port+dbname (lines 60-65).

### 3c. Tests cannot TRUNCATE the runtime DB — PASS with recommendation

- Structural containment: every `loadDatabaseConfig(` call under `tests/` passes `{ test: true }` (grep verified: zero call sites resolve the runtime URL), so DB-backed tests only ever connect to `GEO_TEST_DATABASE_URL`. Example: `tests/persistence/pg-tenancy-runtime.pg.test.ts:23` then TRUNCATE at line 61.
- Name guard: `src/runtime/observability/database-environment-preflight.ts:121-127` — the test role FAILs `DATABASE_PURPOSE_MISMATCH` unless the db NAME contains `test` ("refusing a database that is not clearly throwaway (tests TRUNCATE it)"); the runtime role FAILs if its name looks like test/canary (lines 147-154). CLI mirror: `scripts/preflight/database-environment.mjs:93,106`.
- **GAP (recommendation, not a violation):** the "name must contain `test`" guard lives ONLY in the preflight (an operator-run `npm run preflight:db-env`), not in the test bootstrap itself. If an operator mis-points `GEO_TEST_DATABASE_URL` at the runtime database and skips preflight, the suites would TRUNCATE it — nothing at TRUNCATE time re-checks the db name. Recommended follow-up (test-only change, no product code): assert `current_database() ILIKE '%test%'` in the shared pg-test `beforeAll` before the first TRUNCATE. Primary control (role-variable separation) and secondary control (preflight) are both present and verified, so this is defense-in-depth, not an RC blocker.

### 3d. Preflight taxonomy present — PASS

- `src/runtime/observability/database-environment-preflight.ts:41-47` — closed taxonomy `DATABASE_URL_MISSING | DATABASE_AUTH_FAILED | DATABASE_ROLE_INVALID | DATABASE_PURPOSE_MISMATCH | DATABASE_UNREACHABLE | DATABASE_MIGRATION_BEHIND`; connection-error classification (lines 159-180); superuser refusal + test-role TRUNCATE-privilege probe (lines 193-223); migration-floor check derived from `migrations/manifest.json` (lines 230-260); full three-role orchestration (lines 284-345).
- Tests exist for both offline taxonomy and live pass: `tests/runtime/staging/database-environment-preflight.test.ts`, `tests/runtime/staging/database-environment-preflight.pg.test.ts`. npm entry: `package.json:18` (`preflight:db-env`); migrate helpers for each role: `package.json:15-17` (`db:migrate`, `db:migrate:test`, `db:migrate:canary`).

## Item 4 (environment half) — PROVIDER_RUNTIME_ENABLED not globally enabled anywhere committed

**Verdict: PASS**

- Only tracked env file is `.env.example` (`git ls-files` grep); it does not set `PROVIDER_RUNTIME_ENABLED`. `.gitignore:10-12` excludes `.env`, `.env.*`, re-includes only `.env.example`.
- Flag semantics default OFF: `src/runtime/provider/feature-flag.ts:35-41`.
- All committed `PROVIDER_RUNTIME_ENABLED=true` occurrences are: test-local env objects paired with fake fetch + global-fetch spies (`tests/runtime/provider/openai-adapter.test.ts:51,209-214`; `tests/runtime/provider/provider-ledger.pg.test.ts:494-514`), flag-parsing assertions (`tests/runtime/provider/feature-flag.test.ts`; `tests/pilot/closed-pilot-operations.e2e.pg.test.ts:1476`), the canary runner's per-process `-e` wrapper documentation (`scripts/provider/micro-canary.mjs:6,40-41` — explicitly "never persisted"), and the staging preflight WARN that fires if the flag is ever found true (`scripts/preflight/preflight.mjs:102`).

## Item 10 — No secrets in the committed tree

**Verdict: PASS**

- Targeted pattern grep over the full committed tree (`src/`, `tests/`, `scripts/`, `migrations/`, `docs/`, root files) for `sk-…` API-key shapes, `AKIA…` AWS keys, PEM private-key headers, hardcoded `password=`, and long `Bearer` literals: zero hits outside `CHANGE_ME`/example placeholders.
- Tracked env files: only `.env.example`, all values `CHANGE_ME` placeholders (verified content). `.env.local` is gitignored and untracked.
- No tracked file matches `secret|credential|*.pem|*.key` naming (git ls-files grep).
- The repo additionally ships its own scanner (`scripts/security-scan.mjs`, npm `security-scan`, `package.json:13`) and the tree carries the prior clean-scan reword commit `9e56035` ("clear security-scan false positive (Bearer-header prose)").
- Canary/adapter never print or persist the key: `openai-compatible-adapter.ts:36-40,449-450` (key transient, used only in the Authorization header); `micro-canary.mjs:32-37` (refuses a stale generic key without printing it; never echoes `DEEPSEEK_API_KEY`).

## Overall verdict for this document

**PASS_WITH_CHANGES** — the three-role separation, canary refusal logic, preflight taxonomy, flag
default-OFF, and secret hygiene are all verified in the integrated tree. One recommended
defense-in-depth change (a TRUNCATE-time db-name assertion in the shared test bootstrap) is
follow-up work, not an RC blocker.
