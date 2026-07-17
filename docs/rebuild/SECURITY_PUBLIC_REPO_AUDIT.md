# SECURITY_PUBLIC_REPO_AUDIT

Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).
Repository visibility as of this audit: **PUBLIC** (unchanged since the
baseline). Every rule below is still in force.

## Fresh scan performed for this audit (not a repeat of prior claims)

`node scripts/security-scan.mjs` re-run directly against the current
working tree of every active branch, as of this cycle:

| Branch | Result |
|---|---|
| `main` | clean |
| `rebuild/tenancy-auth` | clean |
| `rebuild/frontend-workspaces` | clean |
| `rebuild/geo-business-pipeline` | clean |
| `integration/rebuild-nightly` | clean |

## Known findings from earlier in the session (already resolved, recorded here for the audit trail)

1. **Real committer email leaked into documentation, caught pre-commit.**
   While writing `docs/rebuild/SECURITY_IMPORT_REPORT.md` and
   `RECOVERY_ASSET_MANIFEST.md` during baseline construction, the account
   owner's real email address (found in the recovery source's git reflog)
   was briefly quoted while *explaining* why it was excluded. Caught by
   the pre-`git add` sweep before any commit; both files redacted. Never
   reached the remote.
2. **`next@16.2.10`'s bundled `postcss@8.4.31` matched GHSA-qx2v-qp2m-jg93**
   (moderate, unescaped `</style>` XSS in CSS stringification), introduced
   by checkpoint C1. Found during Agent A's verification pass (the
   spawning agent's own `npm audit fix` suggestion would have downgraded
   to `next@9.3.3`, a large regression); fixed instead with a `package.json`
   `overrides` entry pinning `postcss ^8.5.10` tree-wide. Re-verified: 0
   vulnerabilities. This is the standing pattern this audit expects future
   checkpoints to follow — check for a narrower fix before accepting an
   `npm audit fix --force` major-version downgrade.
3. **A stray git conflict marker committed into `integration/rebuild-nightly`'s
   history.** Not a security issue in the traditional sense, but a repo-integrity
   one: caused by an incompletely-resolved merge a few cycles back. Found via
   `git grep` during the fifth integration pass and removed. A whole-tree
   residual-marker check (`git grep -n "^<<<<<<< \|^=======$\|^>>>>>>> "`) has
   been added to the end of every subsequent integration pass.

## Standing gaps (not incidents — documented limitations)

- `migrations/0001_tenancy_foundation.sql` is `UNTESTED_AGAINST_LIVE_DB`. Its
  invariants have been reviewed by eye and separately proven in application
  code by `InMemoryTenancyRepository` (B5), but never executed against a
  real Postgres instance, because none is available or permitted in this
  environment. Treat the SQL as reviewed-but-unverified until a future
  checkpoint runs it against a real (non-production, disposable) database.
- No lane has ever attempted a real AI/LLM provider call or a real database
  connection — this is by design (every relevant checkpoint's prompt
  explicitly forbade it), not something this audit needed to detect.

## What has NOT been found, checked explicitly for this audit

- No `.env`, `.pem`, `.key`, `.pfx`, `.sqlite`, `.db`, `.dump`, or raw `.sql`
  data file anywhere in any branch's tracked file list (only the one
  intentional schema-definition migration file, which contains no data).
- No real customer name, email, phone number, or company name in any
  fixture across any of the three frontend workspace surfaces — every
  fixture uses "示例" (example) framing, consistent since C1.
- No AI/model provider or vendor name (OpenAI, DeepSeek, Anthropic, Claude,
  GPT, WeChatSync, ChatGPT) in any client- or ops-visible display string —
  actively tested by `tests/client-workspace-copy.test.ts` (C2) and
  `tests/ops-workspace-copy.test.ts` (C4), both still passing as of the
  last integration pass.
- No default-enabled distribution channel or publisher connector anywhere —
  actively tested in both the C2 client delivery center and the C4 ops
  publisher-connectors page.

## Recommendation

Repository visibility should remain PUBLIC-with-restrictions under the
current rules until the project owner explicitly switches it to Private.
Nothing found in this audit changes that recommendation in either
direction — no incident requiring an emergency visibility change occurred.
