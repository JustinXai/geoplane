# LOCAL CLOSED-PILOT OPERATOR CHECKLIST

Record only PASS, FAIL, BLOCKED, timestamps, and non-secret observations. Never copy environment values into this file.

## Before start

- [ ] Worktree is `local/closed-pilot-staging-v1`; `main` is not checked out here.
- [ ] Working tree is understood; no unrelated local changes will be overwritten.
- [ ] A current local Git bundle and manifest exist outside the repository.
- [ ] Dependencies are already installed from the lockfile.
- [ ] `.env.local` exists and remains ignored.
- [ ] Runtime/test/canary URLs identify `geoplane_local_runtime`, `geoplane_local_test`, and `geoplane_local_canary` respectively.
- [ ] Session signing and review-reference keys are present; their values were not printed.
- [ ] `PROVIDER_RUNTIME_ENABLED=false`.
- [ ] No real customer data is present.
- [ ] `npm run local:preflight` passes.

## Start and health

- [ ] `npm run local:start` succeeds once and is safe to repeat.
- [ ] `npm run local:status` reports the owned process and port without exposing secrets.
- [ ] `/api/health/live` returns 200.
- [ ] `/api/health/ready` returns 200.
- [ ] Migrations `0001` through `0008` are applied.

## Sanitized functional review

- [ ] Platform Admin login succeeds through the HTTP login route.
- [ ] Agency Owner login succeeds and sees only explicitly assigned clients.
- [ ] Client Owner login succeeds and sees only their organization.
- [ ] Sanitized document ingestion and knowledge confirmation succeed.
- [ ] Enterprise profile, keyword/question map, and opportunity are persisted.
- [ ] Client human review is explicit; no automatic review occurs.
- [ ] Offline deterministic content compiles and all three gates pass.
- [ ] Article approval is explicit; no automatic approval occurs.
- [ ] Distribution begins with zero selected channels.
- [ ] Publication receipt is recorded manually; no automatic publication occurs.
- [ ] Client delivery, agency progress, and ops audit are readable.
- [ ] Audit actor identity matches the authenticated session for writes.
- [ ] Provider ledger gained no real-execution row.

## Continuity and recovery

- [ ] Stop/start preserves login and business data.
- [ ] Connection-pool rebuild preserves business data.
- [ ] Routine session-key rotation accepts old and new sessions during the window.
- [ ] Removing the previous key invalidates the old session.
- [ ] Runtime backup completes and its SHA-256 checksum is recorded outside Git.
- [ ] Restore verification into `geoplane_local_restore_verify` passes.
- [ ] Restored accounts, memberships, project, knowledge, profile, keyword map, opportunity, review, article, delivery, audit, and provider ledger are readable.

## Stop and handoff

- [ ] `npm run local:stop` succeeds.
- [ ] The app process is gone and its port is released.
- [ ] Runtime data still exists.
- [ ] Provider runtime is still OFF.
- [ ] Full gates and supervisor audits are recorded honestly.
- [ ] Final local commit and Git bundle are verified.
- [ ] `REMOTE_WRITE_ATTEMPTS = 0`.
- [ ] Provider real calls this stage = 0; historical total remains 1.
