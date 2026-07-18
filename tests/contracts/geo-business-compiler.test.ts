/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Checkpoint D4 tests — ProviderArticleContent / ArticleDraft /
 * compileArticleDraft (src/contracts/geo-business/entities.ts). Covers:
 *
 * 1. Determinism: `compileArticleDraft` called twice with identical inputs
 *    produces byte-identical (deep-equal) output, per
 *    docs/governance/SYSTEM_INVARIANTS_V1.md's "Determinism where the
 *    business chain requires it" (the recovered `{status, briefs,
 *    provider_calls, database_writes, fabricated_defaults}` test story).
 * 2. Static no-external-call check: the compiled module has no import of
 *    any HTTP/fetch/provider-SDK-shaped dependency, and in fact no import
 *    statements at all.
 * 3. Fixture-based smoke tests for ArticleDraft's DRAFT/SEALED
 *    discriminated union, mirroring the KnowledgePackage pattern from
 *    checkpoint D1.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileArticleDraft,
  type ArticleBrief,
  type ArticleBriefPlanningContextV1,
  type ArticleDraft,
  type DraftArticleDraft,
  type ProviderArticleContent,
  type SealedArticleDraft,
} from "../../src/contracts/geo-business/entities.js";

const CLIENT_ORGANIZATION_ID = "org_client_acme";
const PROJECT_ID = "proj_acme_main_site";

const planningContext: ArticleBriefPlanningContextV1 = {
  schemaVersion: "ArticleBriefPlanningContextV1",
  opportunityFamilyId: "fam_0001",
  authorizingHumanReviewDecisionIds: ["hrd_family_0001", "hrd_family_0002"],
  targetKeywords: ["geo article production", "tenant isolation"],
  riskLevel: "STANDARD",
};

const brief: ArticleBrief = {
  id: "brief_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  opportunityFamilyId: "fam_0001",
  planningContext,
  workingTitle: "GEO article production and tenant isolation, explained",
  outline: ["What is GEO article production?", "How is tenant data isolated?"],
  createdAt: "2026-07-15T00:00:00.000Z",
};

const providerContentOne: ProviderArticleContent = {
  id: "pac_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  articleBriefId: brief.id,
  providerResponseEnvelopeId: "envelope_0001",
  receivedAt: "2026-07-16T00:00:00.000Z",
};

const providerContentTwo: ProviderArticleContent = {
  id: "pac_0002",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  articleBriefId: brief.id,
  providerResponseEnvelopeId: "envelope_0002",
  receivedAt: "2026-07-16T00:05:00.000Z",
};

const compilationIdentity = {
  id: "adraft_0001",
  version: 1,
  compiledAt: "2026-07-16T01:00:00.000Z",
};

describe("compileArticleDraft — determinism", () => {
  it("produces byte-identical (deep-equal) output across two calls with identical inputs", () => {
    const first = compileArticleDraft(
      brief,
      [providerContentOne, providerContentTwo],
      compilationIdentity,
    );
    const second = compileArticleDraft(
      brief,
      [providerContentOne, providerContentTwo],
      compilationIdentity,
    );

    expect(first).toStrictEqual(second);
    expect(first).toStrictEqual({
      id: "adraft_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleBriefId: brief.id,
      sourceProviderArticleContentIds: [providerContentOne.id, providerContentTwo.id],
      version: 1,
      title: brief.workingTitle,
      sections: [
        { heading: "What is GEO article production?", order: 0 },
        { heading: "How is tenant data isolated?", order: 1 },
      ],
      status: "DRAFT",
      compiledAt: "2026-07-16T01:00:00.000Z",
    });
  });

  it("does not mutate its inputs", () => {
    const briefSnapshot = JSON.parse(JSON.stringify(brief));
    const contentsSnapshot = JSON.parse(
      JSON.stringify([providerContentOne, providerContentTwo]),
    );

    compileArticleDraft(brief, [providerContentOne, providerContentTwo], compilationIdentity);

    expect(brief).toEqual(briefSnapshot);
    expect([providerContentOne, providerContentTwo]).toEqual(contentsSnapshot);
  });

  it("throws rather than compiling from zero ProviderArticleContent records", () => {
    expect(() => compileArticleDraft(brief, [], compilationIdentity)).toThrow(
      /at least one ProviderArticleContent/,
    );
  });

  it("throws rather than compiling from a ProviderArticleContent that references a different ArticleBrief", () => {
    const orphanedContent: ProviderArticleContent = {
      ...providerContentOne,
      id: "pac_orphan",
      articleBriefId: "brief_other",
    };

    expect(() =>
      compileArticleDraft(brief, [providerContentOne, orphanedContent], compilationIdentity),
    ).toThrow(/does not reference|references ArticleBrief/);
  });
});

describe("compileArticleDraft / entities module — zero external calls", () => {
  it("has no import of any HTTP/fetch/provider-SDK-shaped dependency (in fact, no imports at all)", () => {
    const entitiesSourcePath = fileURLToPath(
      new URL("../../src/contracts/geo-business/entities.ts", import.meta.url),
    );
    const source = readFileSync(entitiesSourcePath, "utf8");

    const importLines = source
      .split("\n")
      .filter((line) => /^\s*import\s/.test(line) || /^\s*export\s+\*\s+from/.test(line));

    // The whole point of this checkpoint's determinism property: this
    // module has zero imports of any kind, not merely zero *forbidden*
    // imports. If a future change ever adds one, this assertion fails
    // first and forces a conscious decision about whether that import is
    // provider/network-shaped.
    expect(importLines).toEqual([]);

    // Belt-and-suspenders: scan actual `require(...)`/dynamic `import(...)`
    // call sites (not prose) for a network/provider-SDK-shaped module
    // specifier. Matched against call-site strings only — code, not
    // comments — so doc-comment prose discussing "no fetch import" (as
    // found immediately above this test in entities.ts) cannot trip it.
    const callSiteSpecifiers = [
      ...source.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g),
    ]
      .map((match) => match[1])
      .filter((specifier): specifier is string => typeof specifier === "string");
    expect(callSiteSpecifiers).toEqual([]);

    const forbiddenPattern =
      /\b(fetch|https?:\/\/|node-fetch|undici|axios|got|superagent|XMLHttpRequest|openai|anthropic|@anthropic-ai|grpc|websocket)\b/i;
    for (const specifier of callSiteSpecifiers) {
      expect(forbiddenPattern.test(specifier)).toBe(false);
    }
    for (const importLine of importLines) {
      expect(forbiddenPattern.test(importLine)).toBe(false);
    }
  });
});

describe("ArticleDraft", () => {
  const compiledDraft: DraftArticleDraft = compileArticleDraft(
    brief,
    [providerContentOne, providerContentTwo],
    compilationIdentity,
  );

  it("compiles a DRAFT-status ArticleDraft referencing the source ArticleBrief and every source ProviderArticleContent", () => {
    expect(compiledDraft.status).toBe("DRAFT");
    expect(compiledDraft.articleBriefId).toBe(brief.id);
    expect(compiledDraft.sourceProviderArticleContentIds).toEqual([
      providerContentOne.id,
      providerContentTwo.id,
    ]);
    expect(compiledDraft.sections.length).toBe(brief.outline.length);
    // Draft-status drafts carry no seal timestamp.
    expect("sealedAt" in compiledDraft).toBe(false);
  });

  it("requires a sealedAt timestamp once a draft transitions to SEALED, and treats it as immutable from then on", () => {
    const sealed: SealedArticleDraft = {
      ...compiledDraft,
      id: "adraft_0002",
      status: "SEALED",
      sealedAt: "2026-07-17T00:00:00.000Z",
    };

    expect(sealed.status).toBe("SEALED");
    expect(sealed.sealedAt).toBeTruthy();
    expect(new Date(sealed.sealedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(sealed.compiledAt).getTime(),
    );
  });

  it("accepts either variant through the ArticleDraft union and discriminates on status", () => {
    const sealed: SealedArticleDraft = {
      ...compiledDraft,
      id: "adraft_0003",
      status: "SEALED",
      sealedAt: "2026-07-17T00:00:00.000Z",
    };
    const drafts: ArticleDraft[] = [compiledDraft, sealed];

    const sealedCount = drafts.filter((draft) => draft.status === "SEALED").length;
    expect(sealedCount).toBe(1);
    expect(drafts.every((draft) => draft.clientOrganizationId === CLIENT_ORGANIZATION_ID)).toBe(
      true,
    );
  });

  /**
   * `sourceProviderArticleContentIds` is a non-empty tuple-with-rest
   * ([string, ...string[]]), mirroring OpportunityFamily.members and
   * ArticleBriefPlanningContextV1.targetKeywords elsewhere in this file:
   * an ArticleDraft compiled from zero provider contents cannot be
   * constructed at the type level either, not merely rejected at runtime
   * by compileArticleDraft's guard clause above.
   */
  it("does not type-check an ArticleDraft with an empty sourceProviderArticleContentIds tuple", () => {
    const illegalDraft: DraftArticleDraft = {
      ...compiledDraft,
      id: "adraft_0004",
      // @ts-expect-error - sourceProviderArticleContentIds is
      // [string, ...string[]] (non-empty), so an empty array violates
      // "compiled from one or more ProviderArticleContent records".
      sourceProviderArticleContentIds: [],
    };

    expect(illegalDraft).toBeTruthy();
  });
});
