# DEPLOYMENT_INPUTS_TEMPLATE — variable NAMES only, never values

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` / checkpoint `CLOSED_PILOT_RELEASE_EVIDENCE_V1` (Agent E)
- Date: 2026-07-19

This template lists every deployment input the closed pilot needs, by NAME only. It carries **no
values — not even example hosts, ports, or database names**. The only placeholder style permitted
anywhere (here, in `.env.example`, in operator notes) is `CHANGE_ME`. Real values live ONLY in the
gitignored `.env.local` (or the deploy environment's secret store) and are never committed,
printed, or logged — the repository's `security-scan` enforces this and the supervisor verified
zero committed secrets (`docs/release-candidate/ENVIRONMENT_CONFIGURATION_AUDIT.md`, Item 10).

Role semantics for the three database URLs are normative in
`docs/pilot/DATABASE_ENVIRONMENT_ROLES.md`; operational procedures (rotation, provider-off,
canary) are in `docs/pilot/PILOT_OPERATOR_RUNBOOK.md`. Verify a filled-in environment with
`npm run preflight:db-env` — the preflight refuses wrong-purpose targets without ever printing a
credential.

| Variable name | Purpose | Who provisions | Storage rule | Rotation note |
| --- | --- | --- | --- | --- |
| `GEO_DATABASE_URL` | Runtime-role database connection: real application data for the pilot deploy | Pilot operator (DB admin creates role + database; operator writes the URL) | Never committed; gitignored `.env.local` / deploy secret store only; never printed or logged | Rotate the embedded DB credential on schedule or on suspicion; update the URL and restart; run `preflight:db-env` after |
| `GEO_TEST_DATABASE_URL` | Test-role database connection: automated tests TRUNCATE it freely; must always be throwaway (name must contain a test marker per the role rules) | Pilot operator / CI job (in CI it points at the job-local PG16 service, never at any shared DB) | Never committed; `.env.local` or CI job env only; must never point at real data | Rotate with the same cadence as the runtime credential; a mis-pointed value is caught by the preflight purpose check — re-run it after every change |
| `GEO_CANARY_DATABASE_URL` | Canary-role database connection: isolated DB dedicated to provider canary runs; the canary runner reads ONLY this variable and refuses runtime/test targets | Pilot operator (only when a supervised canary is explicitly scheduled) | Never committed; `.env.local` only; must differ from runtime AND test targets (host+port+dbname) | Rotate alongside the other DB credentials; may stay unset in every environment that never runs a canary (the runner aborts without it — safe default) |
| `SESSION_SIGNING_KEY_CURRENT` | Active HMAC key signing session cookies; required in production | Pilot operator (generates a fresh random secret per environment) | Never committed; `.env.local` / deploy secret store only; never logged; distinct per environment | Routine: move value to `SESSION_SIGNING_KEY_PREVIOUS`, set a fresh CURRENT, restart (no forced logout). Emergency: set fresh CURRENT with PREVIOUS empty — every outstanding cookie is invalidated at once. See runbook §8 |
| `SESSION_SIGNING_KEY_PREVIOUS` | Previous signing key honored during a rotation window so live cookies keep verifying | Pilot operator (set only during a rotation window) | Never committed; same store as CURRENT | Clear (set empty) after the cookie TTL window fully elapses — that retires the old key; keep it empty when no rotation is open |
| `REVIEW_REFERENCE_KEY_CURRENT` | Keys the opaque client-facing review references separately from session signing; when unset it falls back to `SESSION_SIGNING_KEY_CURRENT` | Pilot operator (optional; decide explicitly at provisioning time) | Never committed; same store as the session keys | If set, rotate on the same discipline as the session keys; rotating it invalidates outstanding opaque review references, so rotate between review batches |
| `PROVIDER_RUNTIME_ENABLED` | Master switch for the real provider runtime; the closed pilot posture is OFF, and unset/garbage resolves OFF (fail-safe default) | Pilot operator; in CI it is never set true (CI required posture: false) | May appear in `.env.local` as an explicit false; never committed as true anywhere | Not a secret — but flipping it ON is a governed, deliberate act limited to a supervised canary process, never a standing setting. Emergency-off: runbook §6 |
| `PROVIDER_BASE_URL` | Base URL of the OpenAI-compatible provider gateway used ONLY when the provider runtime is enabled | Pilot operator (only when a supervised canary/enable is scheduled) | Never committed; `.env.local` only; the host is never persisted to any ledger row, record, or structured log (leak-free shape verified in `PROVIDER_IDENTITY_AUDIT.md`) | Update only as part of a deliberate, reviewed provider configuration change; unset in every environment with the provider OFF |
| `PROVIDER_MODEL` | The single model identifier the provider runtime is permitted to request | Pilot operator, matching the governed provider decision | Never committed; `.env.local` only | Change only through the same review that governs enabling the provider; must stay within `PROVIDER_ALLOWED_MODELS` |
| `PROVIDER_ALLOWED_MODELS` | Closed allowlist of model identifiers the runtime may ever use; requests outside it are refused | Pilot operator, from the governed provider decision | Never committed; `.env.local` only | Tighten freely; widening it is a governed change requiring human review — never widened to unblock a failing run |
| `DEEPSEEK_API_KEY` | Real provider API key for the supervised micro-canary ONLY | Pilot operator, obtained out-of-band from the provider account owner | **Never committed and NEVER present in CI** (CI required posture: key present NO, real calls 0 — see `POSTGRES16_REMOTE_CI_REPORT.md`); gitignored `.env.local` only; never read, echoed, logged, or persisted by any script (the canary runner refuses to print it) | Rotate immediately on any suspected exposure and after each canary window; prefer short-lived provisioning: set it only for the canary run, then remove it |

## Rules recap

1. Names only in this file, `CHANGE_ME` only as a placeholder anywhere else.
2. Nothing here is ever committed with a real value; `.gitignore` excludes `.env` / `.env.*`
   except `.env.example`.
3. The provider key is additionally barred from CI entirely — no GitHub Actions secret, no job
   env. The remote PG16 gate must observe: Provider Runtime Enabled = false, Provider Key Present
   In CI = NO, Real Provider Calls Executed By CI = 0.
4. After filling any database URL, run `npm run preflight:db-env` and require 3/3 PASS before
   promoting the environment.
