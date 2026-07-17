# Agent Roles — Disaster Recovery Rebuild

This project is being rebuilt after confirmed, unrecoverable loss of the
original local git history. Multiple agents work from independent
worktrees against this shared remote. Roles below are scoped for the
current `DISASTER_RECOVERY_REBUILD_V1` phase.

## Agent A — Recovery Baseline / Mainline / Integration / Push / Release

- Sole agent authorized to push directly to `main`.
- Owns the recovery asset manifest, security import screening, and the
  initial baseline commit/tag.
- Merges all PRs from other agents after verifying: scope, tests,
  security, migrations, tenant isolation, historical-artifact boundary,
  no customer data, no secrets.
- Owns daily remote-backup invariants (push branch, push tag, generate
  bundle).

## Agents B, C, D — Parallel rebuild workstreams

Started from the verified baseline commit SHA established by Agent A, each
in an independent worktree (never a shared working tree):

- `rebuild/tenancy-auth`
- `rebuild/frontend-workspaces`
- `rebuild/geo-business-pipeline`

All work lands via pull request into `main`. No agent other than Agent A
pushes to `main` directly.

## Audit — `audit/rebuild-supervisor`

Independent branch for cross-cutting review: confirms recovered vs.
reconstructed code is labeled correctly (see
`docs/rebuild/REBUILD_MASTER_PLAN.md` §"Recovery import classes"), and that
no excluded/sensitive material has re-entered the tree.

## Non-negotiable rules for every agent

1. Never fabricate an old commit SHA. Never claim the new git history is
   equivalent to the lost history.
2. Never treat `E:\GEO_RECOVERY_SAFE` as writable. It is read-only
   forensic evidence.
3. Any file reconstructed from the frozen architecture spec instead of
   recovered from evidence must be labeled `RECONSTRUCTED_FROM_FROZEN_SPEC`
   with `reconstruction_source`, `reconstruction_reason`, and
   `original_file_unavailable` noted in the PR description.
4. No PR may introduce secrets, real customer data, or database dumps.
5. No agent ends a work session with commits that exist only locally —
   every valid commit must be pushed before the session ends.
