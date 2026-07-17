# RECOVERY_GAP_ANALYSIS

Derived from the read-only scan of `E:\GEO_RECOVERY_SAFE` performed for
this baseline, and from the forensic conclusions already recorded in
`docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md` and
`TARGET_STATE_MANIFEST.md` (carried forward as evidence, not re-derived).

## Critical (P0) gaps — blocks a mechanically buildable repo

| Item | Status |
|---|---|
| `package.json` | **Not recovered.** No copy found anywhere in the recovery source. |
| Lockfile (`pnpm-lock.yaml` / `package-lock.json`) | **Not recovered.** |
| `tsconfig.json` | **Not recovered.** |
| Source root layout | **Not recovered as a directory tree.** 7 individual `.tsx`/`.ts` files recovered with content but no path (see `recovered/partial-source/`). |
| Test suite | **Not recovered as files.** One test *behavior* is documented as evidence (vitest coverage of `buildArticleBriefOfflineV1`: human-review mapping, risk escalation, illegal-family rejection, determinism/immutability) but the actual test source was not present in this recovery source. |
| Database migrations | **Not recovered.** No migration files, no schema SQL, no `CREATE TABLE`/`pgTable` hits anywhere in the 1,480 recovered git objects or 10 orphan files. |
| Governor / system invariants code | **Not recovered as code.** Frozen as a design document in `docs/governance/SYSTEM_INVARIANTS_V1.md` based on the user's authoritative restatement, not on recovered source. |

**Conclusion: this baseline cannot be typechecked, tested, or built as-is.**
Any of the above must be reconstructed (class C, frozen-spec) or found in a
later, more complete disk-recovery pass before P0 work can start.

## Partially resolved (P1 architecture, evidence-backed)

Tenancy/auth: 15 commit-message-only entries describe an ordered sequence
of work (tenancy data-integrity acceptance, organization de-duplication
gate, organization creation idempotency contract, identity callback
verification, account-onboarding workspace close-out) but their trees are
unrecoverable — 0/117 recovered commit root trees resolve. Independently,
7 real, readable source files were recovered (`page.tsx`×5 minus 2
corrupted, `route.ts`×1, `shared.tsx`×1) confirming: `OrganizationCreateForm`,
`ProjectCreateForm`, `AssignmentForm`, `AgencyClientCreateForm` components;
a `tenancyRepository` server module with `listOrganizations`, `listAudit`,
`revokeInvitation`; and an authorization surface
`requireSurfaceAuthorization("ops")`. This is real, not reconstructed —
see `recovered/partial-source/`.

## Unresolved — genuinely unknown, not assumed lost

- `D:\Documents\geo-reference-data\backups\geo-control-plane\{kir-01-closed,kwr-01-ws1-pre-migration,kwr-01-ws3a-pre-migration}` and the three backup files inside it (`.dump`, `.sql`, `backup-manifest.json`) — path does not exist on disk today. Working hypothesis carried over from the forensic session: it was swept by the same deletion event as `.runtime\postgres\data` and 6 sibling worktrees, not a bad path record — **unconfirmed**.
- A wider disk-recovery pass (`F:\TestDisk_Recovery`) had not finished as of the last forensic session and was not re-scanned for this baseline. Anything found there later is a genuine addition to this gap analysis, not a contradiction of it.
- Domain type names the user recalled (`ChannelNeutralContentPackageV1`, `KnowledgeDocument`/`KnowledgeVersion`/`KnowledgeChunk`, `ArticleExecutionContext`, etc.) — zero literal hits in recovered evidence. Related concepts exist (`required_knowledge_references`, `ArticleBriefCandidateV1Schema`, `PublishPackageReadinessV1`) suggesting the domain area is real but names may have drifted from the user's memory of an earlier/later revision. Do not treat the user's exact names as verified source-code fact when reconstructing (class C) — flag the naming as a documented assumption.

## Confirmed lost (technical evidence, not absence of search)

- Both recovered git pack files: invalid PACK signature.
- Postgres `data/base/1` and `pg_wal`: verified-empty directories with
  matching "could not open file" runtime errors in the same time window —
  actively deleted, not unindexed.
- 0 of 117 recovered commit root trees resolve to a valid tree object.

## Net effect on rebuild strategy

Confirms the master-plan classification: this is **not** a from-scratch
rewrite (there is real, verifiable evidence the article-production line
and the tenancy/governance line both existed and were in active use), but
it is also **not** a mechanical restore. P0 scaffolding must be
reconstructed against frozen specs before any P1+ work is testable.
