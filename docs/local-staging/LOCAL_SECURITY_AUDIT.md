# LOCAL SECURITY AUDIT — FINAL FIXED-SHA REVIEW

Reviewed integration SHA: `21c38b2d37f9b3e41e17983cd1a32da2be0eeb70`

Review date: 2026-07-19 (Asia/Shanghai)

Decision: **PASS**

`REMOTE_WRITE_ATTEMPTS = 0`

## Evidence boundary

The Supervisor performed a read-only source and committed-evidence review. No `.env.local` value,
database row, database URL, signing key, password, Provider key, or remote state was read. No test,
database command, Provider command, remote command, application stop, or process termination was
performed by the Supervisor.

Agent A supplied execution evidence for the fixed SHA: full tests 951 PASS with the single forbidden
real-Provider micro-canary test skipped; typecheck, build, security scan, and repo safety PASS;
three network login/account checks returned 200; Provider executions, real-customer rows, and
automatic publications were zero. These results are accepted as integration-gate evidence and were
not independently re-executed by the Supervisor.

## Closed first-round findings

### Credential authentication and non-enumeration — CLOSED

- Migration `0009_password_credentials.sql` stores only a nullable versioned scrypt digest; existing
  users remain locked until provisioned.
- `password-credential.ts` uses random salt, scrypt (`N=16384`, `r=8`, `p=1`), a fixed-size derived
  key, and `timingSafeEqual`.
- Login performs the expensive verification path for both known and unknown users using a
  non-authenticating dummy digest, then returns the same `401 Invalid email or password` response.
- A missing digest fails closed. No plaintext password is returned or persisted by the route.

Result: **PASS** by static review plus supplied route/test evidence.

### Session actor binding — CLOSED

`distribution-plans/route.ts` and `publication-receipts/route.ts` no longer read actor IDs from the
body. Both persist `session.userId`, while the command audit actor is derived from the same session.
Body-supplied spoof values therefore cannot override the authenticated actor.

Result: **PASS** by static review plus supplied full-test evidence.

### Contained loopback HTTP cookie exception — ACCEPTED

The production/staging cookie remains `Secure` unless all four exact values are present:

- `LOCAL_ONLY_MODE=TRUE`
- `REMOTE_WRITE=FORBIDDEN`
- `LOCAL_APP_HOST=127.0.0.1`
- `LOCAL_SESSION_COOKIE_SECURE=false`

The managed start command sets those values itself and starts Next with `-H 127.0.0.1`. The cookie
continues to carry `HttpOnly`, `SameSite=Lax`, root path, and bounded Max-Age; the existing same-origin
CSRF middleware remains active. Tests prove changing any one containment value restores `Secure` in
production. Ordinary production/staging remains Secure-cookie-only.

Result: **PASS for the managed local launcher**. Operators must not reuse the four-flag exception
with a manually rebound/non-loopback server.

### Remote-independent repo safety — CLOSED

The repo safety script no longer reads or prints an origin URL, inspects remote-tracking refs,
recommends push, or contains a Git operation capable of network access. It refuses an upstream and
now fail-closes unless `LOCAL_ONLY_MODE=TRUE` and `REMOTE_WRITE=FORBIDDEN` are resolved exactly from
the process or gitignored local configuration. Focused evidence reports the updated gate PASS. No
remote operation was performed in this review.

### Provider boundary — CLOSED

Local preflight blocks unless `PROVIDER_RUNTIME_ENABLED` is explicitly false. Managed start now
builds a dedicated child environment that removes Provider credential names across
OPENAI/PROVIDER/ANTHROPIC/GEMINI/DEEPSEEK API-key/token/secret families and forces the runtime flag
false. The functional runner additionally refuses the canary flag and requires zero
`provider_execution` rows. Supplied execution evidence records zero calls this stage, the only
micro-canary test skipped, and the focused offline hardening tests PASS.

## Final stop and post-stop evidence — PASS

The Supervisor independently confirmed that the managed state file is absent, the committed
`local:status` command reports `STOPPED (no managed process state)`, port 3000 has zero listeners,
and no Next start/dev process is present. Agent A's secret-safe post-stop output reports local
preflight PASS with Provider OFF, runtime aggregate counts unchanged, and zero Provider rows in
both runtime and restore verification databases. No secret or complete database URL was read.

No security blocker remains for local human functional review.
