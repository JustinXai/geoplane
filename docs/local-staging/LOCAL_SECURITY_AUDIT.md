# LOCAL SECURITY AUDIT — FIRST READ-ONLY REVIEW

Audit scope: `LOCAL_CLOSED_PILOT_STAGING_V1` first-round static review.

Snapshot date: 2026-07-19 (Asia/Shanghai)

Decision: **BLOCKED**

`REMOTE_WRITE_ATTEMPTS = 0`

## Reviewed local refs

| Ref | SHA | Static scope |
| --- | --- | --- |
| `main` | `cfb230f1565600ae95c2fd1b78ee92086b498095` | Existing runtime and safety boundaries |
| `local/environment-runtime-v1` | `cfb230f1565600ae95c2fd1b78ee92086b498095` | No committed delta |
| `local/functional-pilot-v1` | `fb1423e541d55dd0e8d1da77f70960d69ae27b4c` | Functional pilot runner and runner tests |
| `local/operator-tooling-v1` | `fd4a49a81c271ec8fc0c33b1cf97da8b2d4abde8` | Local operator documentation |
| `local/recovery-drill-v1` | `cfb230f1565600ae95c2fd1b78ee92086b498095` | No committed delta |
| `local/closed-pilot-staging-v1` | `cfb230f1565600ae95c2fd1b78ee92086b498095` | No integrated delta at snapshot |

No remote command or Provider was invoked during this audit. This repository does not provide a trustworthy local audit trail of historical `git push` executions, so stage-wide past Git push attempts are **NOT_VERIFIED**; the Supervisor's own attempts are zero.

## Blocking findings

### SEC-01 — Login does not verify a credential

Severity: CRITICAL

`src/app/api/auth/login/route.ts:4-27` accepts an email address, looks up the user, and issues a signed session. No password, one-time token, or other credential is verified. Anyone who can reach the local HTTP service and knows or guesses one of the sanitized account emails can impersonate that role. This also conflicts with the operator account template, which expects passwords to exist out of band.

Required change: add a local-only credential verification mechanism with stored verifier material outside committed documentation, or otherwise provide an authenticated upstream boundary that the route actually verifies. Add negative HTTP tests for wrong/missing credentials for all three roles.

### SEC-02 — Distribution and publication actor identities are request-controlled

Severity: CRITICAL

- `src/app/api/distribution-plans/route.ts:49,103` reads `selectedByActorId` from the request body and persists it without requiring equality to `session.userId`.
- `src/app/api/publication-receipts/route.ts:52,98` does the same for `publishedByActorId`.

The sentinel check against strings such as `system` prevents only a small set of labels. An authenticated caller can submit another user's ID or an arbitrary human-looking string, so the durable row can falsely claim who selected channels or published. The associated `audit_event` uses the real session actor, leaving two conflicting actor identities.

Required change: derive both values exclusively from the authenticated session (or enforce an explicit, separately authorized delegation model). Add spoofing tests proving a body-supplied actor cannot override the session actor.

### SEC-03 — Existing preflight does not fail closed when Provider runtime is enabled

Severity: HIGH

`scripts/preflight/preflight.mjs:102-103` reports `PROVIDER_RUNTIME_ENABLED=true` as a non-blocking warning. The required local environment branch has no committed delta, and `package.json` has no `local:preflight`, `local:start`, `local:status`, or `local:stop` command at this snapshot. There is therefore no committed stage-level gate proving that the application cannot start with a real Provider enabled.

The functional runner at `fb1423e` is safer in isolation: it requires the flag to be exactly `false`, refuses `RUN_PROVIDER_CANARY=true`, removes known live-provider variables from its child environment, and forces both provider switches off. That is a **STATIC OBSERVATION**, not a run result and not a substitute for the application start gate.

### SEC-04 — Repo safety preflight is incompatible with local-only posture and may expose a credential-bearing origin

Severity: HIGH

`scripts/repo-safety-preflight.mjs:43-59` requires an `origin`, prints the complete configured origin URL, checks an `origin/<branch>` tracking ref, and tells the operator to push. It performs no network operation itself, but the output and guidance violate the current local-only operating contract. If an origin URL contains embedded credentials, line 47 would print them.

Required change: the local-stage safety command must not require or print an origin URL and must not recommend push. It may inspect local commits, tags, bundles, and worktree safety only.

### SEC-05 — Stage-wide prevention of the committed micro-canary entry point is incomplete

Severity: HIGH

The historical `scripts/provider/micro-canary.mjs` entry point remains executable and is intentionally capable of enabling the real adapter when its flags and key are supplied. Its mere presence is not evidence of a call, and no call was made by this audit. However, until local preflight/start strips or refuses all canary/real-provider enabling inputs, the stage-level prohibition is not enforced at the environment boundary.

Required change: local preflight and start must require explicit Provider OFF, refuse canary execution flags, and avoid passing Provider credentials into the app process. Do not modify the historical canary evidence merely to hide it.

## Additional observations

- The operator documentation commit stores variable names and `NOT_VERIFIED` status only; no actual password, signing key, Provider key, or complete database URL was found in its committed delta by manual review.
- The functional runner's output is aggregate and does not print a database URL or key. Its tests contain clearly synthetic placeholder credentials only.
- The repository security scanner reports only file name and rule label on a match, which is good for redaction. Its patterns are limited and do not establish absence of secrets in arbitrary object/JSON forms. The security scan was not executed during this static review: **NOT_VERIFIED**.
- No GitHub network command was found in the two reviewed branch deltas. Historical remote operations by other processes remain **NOT_VERIFIED**.

## Fresh Reviewer build-race incident

The integration operator reported that `build:web` and `typecheck` were mistakenly started in parallel. Typecheck observed `.next/types` during rebuild (`TS6053`), and an immediate second build reported another build still running. This is the second failure of the same scheduling/re-entrancy issue and must enter `ROOT_CAUSE_MODE`.

Read-only follow-up found no `.next/lock`, no `.next/cache/lock`, and no identifiable running Next build process at the time of review. No process was killed and no lock was removed. These failed attempts are not PASS evidence. Safe recovery is to preserve the first build's final exit/log evidence, verify no build process and no lock, then let one operator run `build:web` to completion and only afterward run `typecheck`. Do not parallelize, blindly delete a lock, or terminate an unverified process.

## Required disposition

Security remains **BLOCKED** until SEC-01 through SEC-05 are closed in the local integration branch and the relevant HTTP/static gates are rerun sequentially. Provider real calls this stage and global remote-write history remain **NOT_VERIFIED** until supported by local evidence; they must not be reported as PASS from code inspection alone.
