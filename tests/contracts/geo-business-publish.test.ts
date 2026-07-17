/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md,
 *   docs/architecture/SYSTEM_BLUEPRINT_V1.md, docs/governance/SYSTEM_INVARIANTS_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Checkpoint D6 tests — PublishPackage / ChannelNeutralContentPackage /
 * DistributionPlan / PublicationReceipt / buildPublishPackage /
 * createChannelNeutralContentPackage / addTargetChannel /
 * createPublicationReceipt (src/contracts/geo-business/entities.ts).
 * Covers:
 *
 * 1. `buildPublishPackage` determinism, mirroring D4's
 *    `compileArticleDraft` / D5's `evaluateQualityGate` determinism tests.
 * 2. A fixture proving `createChannelNeutralContentPackage` always yields
 *    zero target channels, and that growing the list requires the
 *    separate, explicit `addTargetChannel` step.
 * 3. A `@ts-expect-error` fixture proving a `DistributionPlan` cannot be
 *    constructed with an empty `channelIds` tuple, matching the D3
 *    `OpportunityFamily.members` pattern.
 * 4. A `@ts-expect-error` fixture proving a `PublishPackage` cannot be
 *    constructed with a missing/undefined `articleApprovalId`.
 * 5. Runtime-guard coverage for `createPublicationReceipt` rejecting
 *    "system"/"auto"-style actor ids, per SYSTEM_INVARIANTS_V1.md's
 *    "No automatic publication under any circumstance".
 */
import { describe, expect, it } from "vitest";
import {
  addTargetChannel,
  buildPublishPackage,
  compileArticleDraft,
  createChannelNeutralContentPackage,
  createPublicationReceipt,
  evaluateQualityGate,
  type ArticleApproval,
  type ArticleBrief,
  type ArticleBriefPlanningContextV1,
  type ArticleDraft,
  type ChannelNeutralContentBlock,
  type ChannelNeutralContentPackage,
  type DistributionPlan,
  type PassedPlatformGate,
  type PassedQualityGate,
  type PassedVerticalGate,
  type ProviderArticleContent,
  type PublishPackage,
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

const draft: ArticleDraft = compileArticleDraft(
  brief,
  [providerContentOne, providerContentTwo],
  { id: "adraft_0001", version: 1, compiledAt: "2026-07-16T01:00:00.000Z" },
);

const qualityGate: PassedQualityGate = evaluateQualityGate(draft, brief, {
  id: "qg_0001",
  evaluatedAt: "2026-07-17T00:00:00.000Z",
}) as PassedQualityGate;

const platformGate: PassedPlatformGate = {
  id: "pg_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  gateKind: "PLATFORM_GATE",
  articleDraftId: draft.id,
  industryProfileId: "ind_0001",
  gateLevelApplied: "PLATFORM_WIDE_GATE",
  status: "PASSED",
  evaluatedAt: "2026-07-17T00:10:00.000Z",
};

const verticalGate: PassedVerticalGate = {
  id: "vg_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  gateKind: "VERTICAL_GATE",
  articleDraftId: draft.id,
  industryProfileId: "ind_0001",
  gateLevelApplied: "INDUSTRY_VERTICAL_GATE",
  status: "PASSED",
  evaluatedAt: "2026-07-17T00:11:00.000Z",
};

const approval: ArticleApproval = {
  id: "approval_0001",
  clientOrganizationId: CLIENT_ORGANIZATION_ID,
  projectId: PROJECT_ID,
  articleDraftId: draft.id,
  approverId: "user_platform_jane",
  approvedAt: "2026-07-17T02:00:00.000Z",
  qualityGateId: qualityGate.id,
  qualityGateStatus: qualityGate.status,
  platformGateId: platformGate.id,
  platformGateStatus: platformGate.status,
  verticalGateId: verticalGate.id,
  verticalGateStatus: verticalGate.status,
};

const publishPackageIdentity = {
  id: "pub_0001",
  builtAt: "2026-07-18T00:00:00.000Z",
};

describe("buildPublishPackage — determinism", () => {
  it("produces byte-identical (deep-equal) output across two calls with identical inputs", () => {
    const first = buildPublishPackage(approval, draft, publishPackageIdentity);
    const second = buildPublishPackage(approval, draft, publishPackageIdentity);

    expect(first).toStrictEqual(second);
    expect(first).toStrictEqual({
      id: "pub_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleApprovalId: approval.id,
      articleDraftId: draft.id,
      title: draft.title,
      builtAt: "2026-07-18T00:00:00.000Z",
    });
  });

  it("does not mutate its inputs", () => {
    const approvalSnapshot = JSON.parse(JSON.stringify(approval));
    const draftSnapshot = JSON.parse(JSON.stringify(draft));

    buildPublishPackage(approval, draft, publishPackageIdentity);

    expect(approval).toEqual(approvalSnapshot);
    expect(draft).toEqual(draftSnapshot);
  });

  it("builds a PublishPackage that references the real, non-orphaned ArticleApproval it was built from", () => {
    const publishPackage: PublishPackage = buildPublishPackage(
      approval,
      draft,
      publishPackageIdentity,
    );

    expect(publishPackage.articleApprovalId).toBe(approval.id);
    expect(publishPackage.articleDraftId).toBe(draft.id);
    expect(approval.articleDraftId).toBe(draft.id);
    expect(publishPackage.title).toBe(draft.title);
  });

  /**
   * "Nothing may be published without an ArticleApproval" (see the D6
   * file-level note in entities.ts, item 1). This is the executable
   * runtime form of that guarantee, complementing the `@ts-expect-error`
   * case below which proves the same thing at the type level.
   */
  it("throws when called with a missing/undefined approval", () => {
    expect(() =>
      buildPublishPackage(
        undefined as unknown as ArticleApproval,
        draft,
        publishPackageIdentity,
      ),
    ).toThrow(/approval is required/);
  });

  it("throws when the approval's articleDraftId does not match the given draft", () => {
    const mismatchedApproval: ArticleApproval = { ...approval, articleDraftId: "adraft_other" };

    expect(() =>
      buildPublishPackage(mismatchedApproval, draft, publishPackageIdentity),
    ).toThrow(/references ArticleDraft/);
  });
});

describe("PublishPackage — ArticleApproval reference is required, non-optional", () => {
  /**
   * The core D6 guarantee for PublishPackage: an object literal cannot
   * satisfy the `PublishPackage` type without `articleApprovalId`, and
   * `buildPublishPackage`'s first parameter is a required, non-optional
   * `ArticleApproval` value (not merely an id) — so there is no call site
   * that can build one from a missing/undefined approval either. Mirrors
   * the D2 `HumanReviewDecision.reviewerId` / D5 `ArticleApproval.approverId`
   * `@ts-expect-error` pattern.
   */
  it("does not type-check a PublishPackage object literal missing articleApprovalId", () => {
    // @ts-expect-error - articleApprovalId is required and non-optional;
    // a PublishPackage object literal without one must fail to compile —
    // nothing may be published without a real ArticleApproval reference.
    const missingApproval: PublishPackage = {
      id: "pub_illegal_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      articleDraftId: draft.id,
      title: draft.title,
      builtAt: "2026-07-18T00:01:00.000Z",
    };

    expect(missingApproval).toBeTruthy();
  });

  it("does not type-check a PublishPackage built with an explicitly undefined articleApprovalId", () => {
    const missingApproval: PublishPackage = {
      id: "pub_illegal_0002",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      // @ts-expect-error - articleApprovalId is typed as `string`, not
      // `string | undefined`; an explicit `undefined` cannot satisfy it.
      articleApprovalId: undefined,
      articleDraftId: draft.id,
      title: draft.title,
      builtAt: "2026-07-18T00:02:00.000Z",
    };

    expect(missingApproval).toBeTruthy();
  });
});

describe("ChannelNeutralContentPackage — zero channels by construction", () => {
  const publishPackage: PublishPackage = buildPublishPackage(
    approval,
    draft,
    publishPackageIdentity,
  );

  const blocks: ChannelNeutralContentBlock[] = [
    { kind: "HEADING", text: "GEO article production, explained", order: 0 },
    { kind: "PARAGRAPH", text: "An introduction grounded in the source knowledge base.", order: 1 },
  ];

  it("createChannelNeutralContentPackage always yields an empty targetChannelIds list, never a default channel", () => {
    const pkg: ChannelNeutralContentPackage = createChannelNeutralContentPackage(
      publishPackage,
      blocks,
      { id: "cncp_0001", createdAt: "2026-07-18T00:05:00.000Z" },
    );

    expect(pkg.targetChannelIds).toEqual([]);
    expect(pkg.targetChannelIds.length).toBe(0);
    expect(pkg.publishPackageId).toBe(publishPackage.id);
    expect(pkg.blocks).toEqual(blocks);
  });

  it("requires the separate, explicit addTargetChannel step to add even one channel, and does not mutate the original package", () => {
    const zeroChannelPkg = createChannelNeutralContentPackage(publishPackage, blocks, {
      id: "cncp_0002",
      createdAt: "2026-07-18T00:06:00.000Z",
    });

    const oneChannelPkg = addTargetChannel(zeroChannelPkg, "channel_client_blog");

    // The original package is untouched (pure, non-mutating step).
    expect(zeroChannelPkg.targetChannelIds).toEqual([]);
    expect(oneChannelPkg.targetChannelIds).toEqual(["channel_client_blog"]);

    const twoChannelPkg = addTargetChannel(oneChannelPkg, "channel_partner_newsletter");
    expect(twoChannelPkg.targetChannelIds).toEqual([
      "channel_client_blog",
      "channel_partner_newsletter",
    ]);
    // oneChannelPkg itself remains unchanged by the second call.
    expect(oneChannelPkg.targetChannelIds).toEqual(["channel_client_blog"]);
  });

  it("is idempotent: adding a channel id already present does not duplicate it", () => {
    const zeroChannelPkg = createChannelNeutralContentPackage(publishPackage, blocks, {
      id: "cncp_0003",
      createdAt: "2026-07-18T00:07:00.000Z",
    });
    const withChannel = addTargetChannel(zeroChannelPkg, "channel_client_blog");
    const withChannelAgain = addTargetChannel(withChannel, "channel_client_blog");

    expect(withChannelAgain.targetChannelIds).toEqual(["channel_client_blog"]);
  });

  /**
   * There is no constructor in this module that accepts a pre-populated
   * `targetChannelIds` list — `createChannelNeutralContentPackage`'s
   * signature has no such parameter at all, so passing one is a
   * compile-time error, not merely something the runtime happens not to
   * do. This proves the "0 channels by default" invariant is hard to
   * violate rather than merely a documented convention.
   */
  it("does not type-check a call to createChannelNeutralContentPackage with a pre-seeded channel list", () => {
    const identity = { id: "cncp_illegal", createdAt: "2026-07-18T00:08:00.000Z" };
    // @ts-expect-error - createChannelNeutralContentPackage takes exactly
    // (publishPackage, blocks, identity); there is no fourth parameter or
    // options bag through which a caller could pre-seed targetChannelIds.
    const seeded = createChannelNeutralContentPackage(publishPackage, blocks, identity, [
      "channel_client_blog",
    ]);

    expect(seeded).toBeTruthy();
  });
});

describe("DistributionPlan — cannot be constructed with zero explicit channels", () => {
  const publishPackage: PublishPackage = buildPublishPackage(
    approval,
    draft,
    publishPackageIdentity,
  );
  const contentPackage = createChannelNeutralContentPackage(
    publishPackage,
    [{ kind: "HEADING", text: "GEO article production, explained", order: 0 }],
    { id: "cncp_dp_0001", createdAt: "2026-07-18T00:09:00.000Z" },
  );

  it("builds a valid plan with a real, human-chosen, non-empty channel list", () => {
    const plan: DistributionPlan = {
      id: "dp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      channelNeutralContentPackageId: contentPackage.id,
      channelIds: ["channel_client_blog", "channel_partner_newsletter"],
      selectedByActorId: "user_platform_jane",
      selectedAt: "2026-07-18T00:10:00.000Z",
    };

    expect(plan.channelNeutralContentPackageId).toBe(contentPackage.id);
    expect(plan.channelIds.length).toBeGreaterThan(0);
    expect(plan.selectedByActorId).toBeTruthy();
    expect(plan.selectedAt).toBeTruthy();
  });

  /**
   * The core D6 guarantee for DistributionPlan, mirroring D3's
   * `OpportunityFamily.members` `@ts-expect-error` case exactly:
   * `channelIds` is a non-empty tuple-with-rest, so an empty array cannot
   * satisfy the type — there is no "ready to distribute" plan with zero
   * explicit human-chosen channels.
   */
  it("does not type-check a DistributionPlan with an empty channelIds array", () => {
    const emptyChannelPlan: DistributionPlan = {
      id: "dp_illegal_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      channelNeutralContentPackageId: contentPackage.id,
      // @ts-expect-error - `channelIds` is a non-empty tuple-with-rest
      // ([string, ...string[]]), matching D3's OpportunityFamily.members
      // pattern; an empty array violates "a human explicitly chose these
      // channels" and must fail to compile.
      channelIds: [],
      selectedByActorId: "user_platform_jane",
      selectedAt: "2026-07-18T00:11:00.000Z",
    };

    expect(emptyChannelPlan).toBeTruthy();
  });

  it("does not type-check a DistributionPlan missing selectedByActorId (no plan without a human who chose)", () => {
    // @ts-expect-error - selectedByActorId is required and non-optional;
    // a DistributionPlan object literal without one must fail to compile.
    const noSelector: DistributionPlan = {
      id: "dp_illegal_0002",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      channelNeutralContentPackageId: contentPackage.id,
      channelIds: ["channel_client_blog"],
      selectedAt: "2026-07-18T00:12:00.000Z",
    };

    expect(noSelector).toBeTruthy();
  });
});

describe("PublicationReceipt — never an automatic actor", () => {
  const publishPackage: PublishPackage = buildPublishPackage(
    approval,
    draft,
    publishPackageIdentity,
  );
  const contentPackage = createChannelNeutralContentPackage(
    publishPackage,
    [{ kind: "HEADING", text: "GEO article production, explained", order: 0 }],
    { id: "cncp_pr_0001", createdAt: "2026-07-18T00:13:00.000Z" },
  );
  const plan: DistributionPlan = {
    id: "dp_0002",
    clientOrganizationId: CLIENT_ORGANIZATION_ID,
    projectId: PROJECT_ID,
    channelNeutralContentPackageId: contentPackage.id,
    channelIds: ["channel_client_blog"],
    selectedByActorId: "user_platform_jane",
    selectedAt: "2026-07-18T00:14:00.000Z",
  };

  it("builds a valid receipt with a real, obviously-fake human actor id", () => {
    const receipt = createPublicationReceipt(plan, "channel_client_blog", "user_platform_jane", {
      id: "receipt_0001",
      publishedAt: "2026-07-18T00:15:00.000Z",
    });

    expect(receipt.distributionPlanId).toBe(plan.id);
    expect(receipt.channelId).toBe("channel_client_blog");
    expect(receipt.publishedByActorId).toBe("user_platform_jane");
  });

  it("builds a valid receipt for an obviously-fake service actor id", () => {
    const receipt = createPublicationReceipt(
      plan,
      "channel_client_blog",
      "svc_publisher_bridge_test",
      { id: "receipt_0002", publishedAt: "2026-07-18T00:16:00.000Z" },
    );

    expect(receipt.publishedByActorId).toBe("svc_publisher_bridge_test");
  });

  it.each(["system", "SYSTEM", "auto", "Auto", "automated", "automatic", "  system  "])(
    "throws for the forbidden automatic-actor value %j",
    (actorId) => {
      expect(() =>
        createPublicationReceipt(plan, "channel_client_blog", actorId, {
          id: "receipt_illegal",
          publishedAt: "2026-07-18T00:17:00.000Z",
        }),
      ).toThrow(/automatic\/system actor/);
    },
  );

  it("throws for an empty actor id", () => {
    expect(() =>
      createPublicationReceipt(plan, "channel_client_blog", "", {
        id: "receipt_illegal_2",
        publishedAt: "2026-07-18T00:18:00.000Z",
      }),
    ).toThrow(/automatic\/system actor/);
  });

  it("throws when the channel is not one of the plan's selected channelIds", () => {
    expect(() =>
      createPublicationReceipt(plan, "channel_never_selected", "user_platform_jane", {
        id: "receipt_illegal_3",
        publishedAt: "2026-07-18T00:19:00.000Z",
      }),
    ).toThrow(/is not one of DistributionPlan/);
  });
});
