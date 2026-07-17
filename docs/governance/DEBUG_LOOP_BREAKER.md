# DEBUG_LOOP_BREAKER

Purpose: stop an agent from silently spending a session re-attempting the
same failing recovery/reconstruction approach.

## When to stop and escalate instead of retrying

- A forensic search for a specific SHA, hash, or keyword has already
  returned "not found" against the full recovered evidence set (see
  `docs/rebuild/RECOVERY_GAP_ANALYSIS.md`) — re-running the identical
  search will not produce a different result. Wait for new recovery input
  (e.g. a completed `F:\TestDisk_Recovery` pass) instead of repeating it.
- A build/typecheck/test failure traces back to a P0 gap
  (`package.json`, lockfile, `tsconfig`, migrations — see
  `RECOVERY_GAP_ANALYSIS.md`) that is not yet reconstructed. Record it as
  `DEPENDENCY_RESTORE_REQUIRED` or the equivalent P0 gap and move to the
  next in-scope task rather than iterating on the same error.
- Two consecutive attempts to reconcile the owner's recollection of a type
  name/schema against recovered evidence both fail to find a literal hit.
  Stop trying variants; document it as an unconfirmed assumption in the
  relevant `docs/architecture/*.md` file (as already done for
  `GEO_BUSINESS_CHAIN_V1.md`) and proceed using the frozen spec.

## What "escalate" means here

Write the blocker down (which gap, which file, what was tried) in the
relevant doc under `docs/rebuild/` or in the PR description, and move to
the next unblocked task in priority order. Do not leave the repository in
a half-edited state while blocked — commit or discard cleanly.
