# GEO_BUSINESS_CHAIN_V1 (frozen)

Status: frozen design restated by the project owner, not a recovered
artifact — see the status note in `SYSTEM_BLUEPRINT_V1.md`.

## Chain (P2 priority)

1. Knowledge package (enterprise knowledge base ingestion)
2. Keyword / user-question map
3. Opportunity validation
4. Human review (gate)
5. Article family
6. Article brief
7. Article compiler
8. Quality gates

## Evidence corroboration

No source files for this chain were recovered, but strong indirect
evidence that this line was real and in production use exists in
`docs/rebuild/recovered-evidence/`:

- A complete, real, currently-passing test story for
  `buildArticleBriefOfflineV1` (offline article-brief generation),
  covering human-review mapping, risk escalation, illegal-family
  rejection, and determinism/immutability — described in the recovery
  matrix, though the actual test source file itself was not recovered.
- A fully-formed evidence-sealing workflow for provider-assisted article
  revision ("OPR-01B Candidate 2"), including a real, valid sealed commit,
  documented failure codes (`ACTUAL_TOKEN_LIMIT_EXCEEDED`,
  `PROVIDER_DRAFT_CONTRACT_INVALID`), and approval states
  (`AUTHORIZED_FINAL_CALL`, `READY_AFTER_HUMAN_APPROVAL`, `PENDING`).
- Real schema/type name hits: `ArticleBriefCandidateV1Schema`,
  `ArticleBriefPlanningContextV1`, `BRIEF_PLANNING_CONTEXT_REQUIRED`, and a
  `"schema_version": "PublishPackageReadinessV1"` string — confirming a
  versioned-schema convention for this chain even though the exact type
  names the owner recalled (`KnowledgeDocument`, `ArticleExecutionContext`,
  etc.) were not found verbatim.

## Explicit caution for reconstruction

The owner-recalled PascalCase type names for this chain
(`ChannelNeutralContentPackageV1`, `KnowledgeDocument`/`KnowledgeVersion`/
`KnowledgeChunk`/`KnowledgeSnapshot`/`KnowledgeIssue`,
`ArticleExecutionContext`, `ArticleOpportunity`, `ArticleFamily`,
`PLATFORM_RULE_GATE`, `VERTICAL_RULE_GATE`, `NEEDS_HUMAN_REVIEW`,
`KNOWLEDGE_GROUNDED_OPPORTUNITY`, `INDUSTRY_HYPOTHESIS`,
`CONFIRMED_DEMAND`) had **zero literal hits** in recovered evidence. Do not
treat these as confirmed source-code fact when writing class-C
reconstructions — implement against the chain description above, and note
in the PR when a specific type name is an assumption rather than a
recovered fact.
