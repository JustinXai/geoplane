# LOCAL FUNCTIONAL AUDIT — FINAL FIXED-SHA REVIEW

Reviewed integration SHA: `ccc2f89f436b46a2bc7f09b82f4e6de7aba04c34`

Decision: **PASS_WITH_CHANGES**

`REMOTE_WRITE_ATTEMPTS = 0`

## Final capability matrix

| Capability | Result | Evidence boundary |
| --- | --- | --- |
| Sanitized seed | PASS | Supplied idempotent runtime evidence: 3 users, 3 organizations, 3 active memberships, 1 assignment, 1 project |
| Platform login/account | PASS | Supplied real loopback network HTTP: 200 / 200 |
| Agency login/account | PASS | Supplied real loopback network HTTP: 200 / 200 |
| Client login/account | PASS | Supplied real loopback network HTTP: 200 / 200 |
| Password authentication | PASS | scrypt digest verification; missing/wrong/unknown fail with the same 401 response |
| Knowledge lifecycle | PASS | Supplied functional-pilot evidence |
| Keyword/opportunity lifecycle | PASS | Supplied functional-pilot evidence |
| Explicit human review | PASS | Session-derived reviewer; no omission/default approval path |
| Article/gates/approval | PASS | Session-derived approver and all three gates required |
| Default selected channels | PASS | Zero at channel-neutral package creation |
| Distribution/publication actor | PASS | Both derive exclusively from `session.userId` |
| Automatic publication | PASS | Supplied evidence: zero; receipt actor is session-bound |
| Client tenant isolation | PASS | Route tests and supplied full-test evidence |
| Agency assignment isolation | PASS | Active assignment allowlist and supplied full-test evidence |
| Audit actor integrity | PASS | Command and distribution/publication actor share the authenticated session identity |
| Provider calls | PASS | Offline adapter evidence; provider executions zero; real micro-canary skipped |
| Real customer data | PASS | Supplied evidence: zero |
| Restart/session rotation | PASS | Supplied recovery suite: 3/3 |
| Backup/restore readback | PASS | Supplied recovery suite: 3/3 |
| Live server stop | NOT_YET_VERIFIED | Managed loopback app still running at review time |

## Assessment

The functional pilot continues to exercise imported Next route handlers with real `Request` objects,
signed cookies, authorization, and PostgreSQL. Separate integration evidence now also covers real
network HTTP against the managed loopback server for all three credentialed roles and authenticated
account reads, closing the first-round live-server gap.

The first-round login and actor-integrity blockers are closed. Public login requires a password;
unknown email and wrong password share the same response. Distribution selection and publication
receipt actor IDs are no longer accepted from the request body and are persisted from the session.

Full-test evidence reports 951 PASS with exactly one intentional skip: the forbidden real Provider
micro-canary. The Supervisor did not rerun these dynamic tests.

## Remaining change

The final safe stop and post-stop persistence checks remain outstanding. Functional readiness is
therefore `PASS_WITH_CHANGES`; it becomes eligible for final local functional review only after the
managed app stops, the port releases, runtime data remains, and Provider OFF is reconfirmed.
