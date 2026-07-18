# PG16_CI_SECURITY_AUDIT — PG16_CI_SUPERVISOR_AUDIT_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` · Supervisor branch: `audit/pg16-ci-supervisor-v1`
- Audited tree: `cf6617d7955bbfd6bd3e8c1bd71fecf983072482` (integration/closed-pilot-rc-ci-v1,
  fast-forward-merged into this branch) — byte-identical to the head_sha of the observed green
  run 29654550660.
- Scope: checklist items 3, 4, 5 + a secrets sweep of `.github/workflows/closed-pilot-postgres16.yml`
  and `scripts/ci/*`.
- Method: static read of the workflow and every `scripts/ci/*.mjs`; pattern sweeps; git history of the
  three fix commits; unauthenticated GitHub REST reads of the public run. No test suite executed, no
  provider called, no credential used, no `.env.local` value read or printed.

## Item 3 — CI contains NO real key: **PASS**

| Check | Evidence |
| --- | --- |
| GitHub `secrets` context never used | The workflow contains **zero** `${{ ... }}` expressions of any kind (grep for `${{` over `closed-pilot-postgres16.yml`: no match), so no `secrets.*`, no `vars.*`, no dynamic injection surface at all. The only `secrets` mentions are the prose comments at lines 5–6. |
| No `DEEPSEEK_API_KEY` anywhere in CI config | grep over `.github/`: no match. The string appears only in product/adapter code (`src/runtime/provider/openai-compatible-adapter.ts:92`), the local-only canary launcher (`scripts/provider/micro-canary.mjs`), the scanner pattern (`scripts/security-scan.mjs:19`), and the two gate scripts that **delete** it (below). |
| Provider key stripped unread from every child env | `scripts/ci/run-database-gates.mjs:73` (`delete env.DEEPSEEK_API_KEY;`) applied to all vitest/migrate/preflight children via `buildChildEnv`; `scripts/ci/run-backup-restore-gate.mjs:191` (`delete childEnvBase.DEEPSEEK_API_KEY;`) applied to backup/restore children. Neither script ever reads the value. |
| Only throwaway credentials present | `geoplane_ci` / `ci_only_not_secret` for the job-scoped `postgres:16` service container (workflow lines 85–86, 100, 105–107, 160–161, 173, 177–179, 230–232) — destroyed with each job. `SESSION_SIGNING_KEY_CURRENT: ci-only-session-signing-key-not-secret-0001` (lines 42, 97, 172) is a clearly-fake, self-labelling constant. |
| No env file created, none committed | Workflow creates no `.env*` file. `git ls-files | grep .env` → only `.env.example`. `.gitignore` blocks `.env` / `.env.*` (plus `*.pem`, `*.key`, `*.pfx`, `*.dump`). |
| Secret-pattern sweep of `.github/` + `scripts/ci/` | grep for `sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, `api[_-]key[:=]` (excluding the self-labelled `not_secret` values): **no hits**. |
| No credential ever printed | `create-isolated-databases.mjs:192-199` sends the app-role password only over the wire inside a `SET LOCAL log_statement = 'none'` transaction; `postgres16-verify.mjs:58-59` prints only the server's own version string; `run-backup-restore-gate.mjs` passes passwords only inside env connection strings (never argv, lines 249–297). |

## Item 4 — CI cannot run the canary: **PASS**

| Check | Evidence |
| --- | --- |
| `RUN_PROVIDER_CANARY` never set in CI | grep over `.github/`: no match. The only place in the tree that sets it is `scripts/provider/micro-canary.mjs:84` — a local, operator-run script the workflow never invokes. |
| Canary test is skip-gated | `tests/pilot/provider-micro-canary.canary.test.ts:27` (`const RUN = process.env.RUN_PROVIDER_CANARY === "true";`) and `:59` (`describe.skipIf(!RUN || canaryConfig === null)`). Unset in CI ⇒ the suite is skipped before any hook runs. |
| Canary suite is not even scheduled in CI | The gate runner's explicit allow-lists `SUITES_RUN_A`/`SUITES_RUN_B` (`run-database-gates.mjs:53-65`) do not include the canary file; the workflow's static-gates job runs no vitest at all. |
| `PROVIDER_RUNTIME_ENABLED=false` workflow-wide and per job | Workflow lines 39 (workflow env), 50 (static-gates), 96 (postgres16-gates), 171 (backup-restore-gates). Flag semantics are default-OFF anyway: `src/runtime/provider/feature-flag.ts:35-41` — only `"true"`/`"1"` enable. |
| Canary target guard (defense in depth) | Even when run locally, the canary refuses the runtime DB and any test-DB overlap (`provider-micro-canary.canary.test.ts:64-66` and the role-purpose checks it inherits). |

## Item 5 — CI cannot enable the provider: **PASS**

| Check | Evidence |
| --- | --- |
| No step sets the flag true | Every occurrence of `PROVIDER_RUNTIME_ENABLED` in `.github/` is `"false"` (lines 12 comment, 39, 50, 96, 171). No `${{ }}` expression exists that could override it. |
| Gate runner re-forces and self-checks | `run-database-gates.mjs:74` forces `"false"` into every child env; `:452-456` re-reads the value the children actually saw and **throws** (`CI_DB_GATE_PROVIDER_FLAG`) if it resolves enabled. |
| Backup gate re-forces | `run-backup-restore-gate.mjs:192` (`childEnvBase.PROVIDER_RUNTIME_ENABLED = "false"`). |
| Evidence records the flag honestly | `generate-ci-evidence.mjs:135` takes `providerRuntimeEnabled` from the job-2 machine record (only `=== true` counts as enabled) and `:181` adds a **failure** if true — the evidence step cannot exit 0 with the flag on. |
| `realProviderCallsExecutedByCI` independently recomputed | `generate-ci-evidence.mjs:68-81, 118-133`: counts `provider_execution` rows with `model <> 'offline-deterministic'` since `runStartedAt` in **each of the three CI databases**; an unreachable/missing table is a hard failure (`CI_EVIDENCE_DB_UNVERIFIABLE`, "unverifiable = failure"); `:182-184` fails the step when the total ≠ 0. Because job backup-restore-gates concluded success in run 29654550660, this step exited 0 ⇒ `providerRuntimeEnabled=false` and `realProviderCallsExecutedByCI=0` **held in the observed run** (per-DB 0/0/0). |
| Scripts have no network surface | grep over `scripts/ci/` for `fetch(`, `http(s)://`, `axios`, `net.`: no match — the gate scripts speak only SQL via `pg` and spawn only repo-local node scripts. |

Honest scope note: the three databases the evidence step counts are job 3's (job 2's service
container is destroyed with its job). Job 2's own zero-real-call guarantee rests on the equally
verified chain: flag forced false + key deleted unread + canary never schedulable + adapter
refusing real calls while the flag is off (`feature-flag.ts:48+`).

## Secrets sweep summary

- Files swept: `.github/workflows/closed-pilot-postgres16.yml` (the only workflow in the repo) and all
  five `scripts/ci/*.mjs` (`create-isolated-databases`, `postgres16-verify`, `run-database-gates`,
  `run-backup-restore-gate`, `generate-ci-evidence`, plus local-only `repeatability-rounds`).
- Findings: **0 real secrets, 0 secret references, 0 secret-context usages.** The static-gates job also
  runs the repo's own `npm run security-scan` and `npm run repo:safety:preflight` (workflow lines 67–71)
  and both passed in the observed green run.
- `scripts/ci/repeatability-rounds.mjs:87` additionally strips `RUN_PROVIDER_CANARY` from its children —
  consistent posture even in the script the workflow does not use.

## Verdict (this document)

**PASS — 0 real violations.** No secret material, no secret reference, no path by which the observed
workflow could obtain a provider key, set the provider flag, or execute the canary.
