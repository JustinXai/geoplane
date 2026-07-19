# LOCAL CLOSED-PILOT STAGING REPORT

Generated: 2026-07-19T10:56:32+08:00

| Required field | Final evidence |
| --- | --- |
| Starting Main SHA | `cfb230f1565600ae95c2fd1b78ee92086b498095` |
| Current Local Integration SHA | `34e432d5587bab1128338b55420fad5b2444254c` |
| Local Branch | `local/closed-pilot-staging-v1` (no upstream) |
| Remote Write Attempts | 0 |
| Git Push Attempts | 0 |
| Provider Real Calls This Stage | 0 |
| Provider Historical Call Count | 1 |
| Provider Runtime Default | OFF; explicit `false`; managed child strips known Provider credentials |
| Runtime Database | `geoplane_local_runtime` |
| Test Database | `geoplane_local_test` |
| Canary Database | `geoplane_local_canary` (purpose isolation only; no canary executed) |
| Database Separation | PASS — exact names, loopback only, distinct targets, dedicated non-superuser role |
| Migration Count | 9/9 current; required baseline 0001–0008 complete plus 0009 password credentials |
| Table Count | 42 in runtime; 42 in test; 42 in canary; 42 in restore verification |
| Local Preflight | PASS before start and after final stop |
| Health Live | PASS — final HTTP 200 |
| Health Ready | PASS — final HTTP 200 |
| Platform Login | PASS — real network login 200; authenticated account read 200 |
| Agency Login | PASS — real network login 200; authenticated account read 200 |
| Client Login | PASS — real network login 200; authenticated account read 200 |
| Knowledge Lifecycle | PASS — sanitized document/confirmation/profile evidence through real route handlers and PostgreSQL |
| Keyword Lifecycle | PASS — keyword/question map persisted and read through the functional pilot |
| Opportunity Lifecycle | PASS — opportunity, explicit human review, and family chain completed |
| Article Lifecycle | PASS — offline content, deterministic compiler, three gates, explicit approval, and publish package completed |
| Delivery Lifecycle | PASS — zero-default-channel plan, manual receipt, client delivery, agency progress, and ops audit completed |
| Restart E2E | PASS — brand-new runtime read persisted state; final start/stop/start cycle retained runtime data |
| Session Rotation E2E | PASS — old session valid during current/previous window, new session valid, old rejected after previous key removal |
| Backup Restore E2E | PASS — pg_dump, SHA-256, fresh restore, and hashed business readback; final restore database retained |
| Tenant Isolation | PASS |
| Agency Assignment Isolation | PASS |
| Audit Actor Integrity | PASS — distribution/publication actors are derived from the authenticated session and match audit actors |
| Automatic Human Review | DISABLED |
| Automatic Article Approval | DISABLED |
| Automatic Publication | DISABLED |
| Default Selected Channel Count | 0 |
| Real Customer Data Used | NO |
| Full Tests | PASS — 96 files / 953 tests passed; the one intentionally skipped test is the forbidden real Provider micro-canary |
| Typecheck | PASS |
| Next Build | PASS |
| Security Scan | PASS |
| Repo Safety | PASS — exact `LOCAL_ONLY_MODE=TRUE`, `REMOTE_WRITE=FORBIDDEN`, no upstream, no remote inspection |
| Supervisor Decision | PASS |
| Local Bundle Path | `E:\GEO_REBUILD_BACKUPS\geoplane\local-closed-pilot-staging-v1-final-20260719-105632.bundle` |
| Open Blockers | None |
| Decision | `LOCAL_CLOSED_PILOT_READY_FOR_FUNCTIONAL_REVIEW` |
| Exact Next Single Action | `PRESENT LOCAL CLOSED-PILOT ENVIRONMENT FOR HUMAN FUNCTIONAL REVIEW` |

## Final stopped state

- Managed application state: absent / STOPPED.
- Port `127.0.0.1:3000`: released; no Next start/dev process remains.
- Runtime data after stop: 3 sanitized users, 3 organizations, 3 memberships, 1 project.
- Restore verification data after stop: 3 sanitized users, 1 project.
- Runtime and restore Provider ledger rows: 0.
- Provider runtime after stop: OFF.
- `REMOTE_WRITE_ATTEMPTS = 0`.

The local HTTP cookie exception is contained to the managed launcher only: it requires the exact four-condition posture (`LOCAL_ONLY_MODE=TRUE`, `REMOTE_WRITE=FORBIDDEN`, `LOCAL_APP_HOST=127.0.0.1`, and `LOCAL_SESSION_COOKIE_SECURE=false`). `HttpOnly`, `SameSite=Lax`, password verification, signed sessions, and CSRF origin checks remain enabled. Ordinary production/staging processes continue to emit `Secure` cookies.

No local branch was merged into `main`. No remote branch, PR, remote tag, GitHub action, public deployment, real customer access, real Provider call, automatic approval, or automatic publication was performed.
