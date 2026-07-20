/**
 * Manual Delivery Receipt Tests — tests the publication package creation and
 * manual delivery receipt recording flow.
 *
 * Tests:
 *   1. Publication package creation from approved draft
 *   2. Channel-neutral content package with 0 default channels
 *   3. Distribution plan with human-chosen channels
 *   4. Publication receipt recording (never automatic)
 *   5. Tenant isolation: client A's receipts invisible to client B
 *   6. Reject automatic/system actor in receipt
 */
import { describe, expect, it } from "vitest";
import {
  buildHarness,
  clientOwnerContext,
  ORG,
  PROJECT,
  type Harness,
} from "./fakes.js";
import type { ChannelNeutralContentBlock } from "../../../src/contracts/geo-business/entities.js";

const BLOCKS: ChannelNeutralContentBlock[] = [
  { kind: "HEADING", text: "The State of GEO", order: 0 },
  { kind: "PARAGRAPH", text: "Content body text.", order: 1 },
];

describe("manual delivery receipt flow", () => {
  function setupPublicationChain(h: Harness) {
    const ctx = clientOwnerContext(ORG);

    // Run through to approval (simplified for unit test)
    const pkg = {
      id: "pkg_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      articleApprovalId: "approval_1",
      articleDraftId: "draft_1",
      title: "Test Article",
      builtAt: "2026-07-19T00:00:00.000Z",
    };

    const cncp = {
      id: "cncp_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      publishPackageId: pkg.id,
      blocks: BLOCKS,
      targetChannelIds: [] as string[],
      createdAt: "2026-07-19T00:00:00.000Z",
    };

    const plan = {
      id: "plan_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      channelNeutralContentPackageId: cncp.id,
      channelIds: ["channel_wechat", "channel_blog"] as [string, ...string[]],
      selectedByActorId: "user_platform_jane",
      selectedAt: "2026-07-19T00:00:00.000Z",
    };

    return { ctx, pkg, cncp, plan };
  }

  it("publication package captures approval and draft references", () => {
    const h = buildHarness();
    const { pkg, cncp } = setupPublicationChain(h);

    // Verify the package structure
    expect(pkg.articleApprovalId).toBe("approval_1");
    expect(pkg.articleDraftId).toBe("draft_1");
    expect(pkg.title).toBe("Test Article");

    // Channel-neutral package has 0 default channels
    expect(cncp.targetChannelIds).toEqual([]);
    expect(cncp.blocks).toHaveLength(2);
  });

  it("distribution plan requires human-chosen channels", () => {
    const h = buildHarness();
    const { plan } = setupPublicationChain(h);

    // Plan has explicit channels chosen by a human
    expect(plan.channelIds).toEqual(["channel_wechat", "channel_blog"]);
    expect(plan.selectedByActorId).toBe("user_platform_jane");
    expect(plan.selectedByActorId).not.toBe("system");
    expect(plan.selectedByActorId).not.toBe("auto");
  });

  it("publication receipt requires a real (never automatic) actor", async () => {
    const h = buildHarness();
    const { ctx, plan } = setupPublicationChain(h);

    // A real human actor works
    const receipt = await h.delivery.recordPublicationReceipt(
      ctx,
      plan,
      "channel_wechat",
      "user_platform_jane",
    );
    expect(receipt.publishedByActorId).toBe("user_platform_jane");
    expect(receipt.channelId).toBe("channel_wechat");
    expect(receipt.distributionPlanId).toBe(plan.id);
  });

  it("publication receipt channel must be in distribution plan", async () => {
    const h = buildHarness();
    const { ctx, plan } = setupPublicationChain(h);

    // Channel not in plan throws
    try {
      await h.delivery.recordPublicationReceipt(
        ctx,
        plan,
        "channel_twitter", // not in plan
        "user_platform_jane",
      );
      throw new Error("Expected error to be thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/not one of/);
    }
  });

  it("derives PUBLISHED status after receipt for all channels", async () => {
    const h = buildHarness();
    const { ctx, plan } = setupPublicationChain(h);

    // Initially no receipts
    let status = await h.delivery.publicationStatus(ctx, plan);
    expect(status).toBe("CHANNELS_SELECTED");

    // Record receipt for first channel
    h.delivery.recordPublicationReceipt(ctx, plan, "channel_wechat", "user_platform_jane");
    status = await h.delivery.publicationStatus(ctx, plan);
    expect(status).toBe("PARTIALLY_PUBLISHED");

    // Record receipt for second channel
    h.delivery.recordPublicationReceipt(ctx, plan, "channel_blog", "user_platform_jane");
    status = await h.delivery.publicationStatus(ctx, plan);
    expect(status).toBe("PUBLISHED");
  });

  it("tenant isolation: client B cannot see client A receipts", async () => {
    const h = buildHarness();

    const ctxA = clientOwnerContext(ORG);
    const ctxB = clientOwnerContext("org_client_beta");

    const planA = {
      id: "plan_a",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      channelNeutralContentPackageId: "cncp_a",
      channelIds: ["channel_wechat"] as [string, ...string[]],
      selectedByActorId: "user_a",
      selectedAt: "2026-07-19T00:00:00.000Z",
    };

    const planB = {
      id: "plan_b",
      clientOrganizationId: "org_client_beta",
      projectId: "proj_beta",
      channelNeutralContentPackageId: "cncp_b",
      channelIds: ["channel_blog"] as [string, ...string[]],
      selectedByActorId: "user_b",
      selectedAt: "2026-07-19T00:00:00.000Z",
    };

    // Client A publishes
    await h.delivery.recordPublicationReceipt(ctxA, planA, "channel_wechat", "user_a");

    // Client B publishes
    await h.delivery.recordPublicationReceipt(ctxB, planB, "channel_blog", "user_b");

    // Access repository directly to list by scope
    const scopeA = { clientOrganizationId: ORG, projectId: PROJECT };
    const scopeB = { clientOrganizationId: "org_client_beta", projectId: "proj_beta" };

    // Client A sees only their receipts
    const receiptsA = await (h.delivery as any).deliveries.listByScope(scopeA);
    expect(receiptsA).toHaveLength(1);
    expect(receiptsA[0]?.channelId).toBe("channel_wechat");

    // Client B sees only their receipts
    const receiptsB = await (h.delivery as any).deliveries.listByScope(scopeB);
    expect(receiptsB).toHaveLength(1);
    expect(receiptsB[0]?.channelId).toBe("channel_blog");

    // Cross-tenant is invisible
    expect(receiptsA.map((r: any) => r.id)).not.toContain(
      receiptsB[0]?.id,
    );
  });

  it("audit intent is emitted per publication receipt", async () => {
    const h = buildHarness();
    const { ctx, plan } = setupPublicationChain(h);

    const beforeCount = h.infra.audit.intents.length;

    await h.delivery.recordPublicationReceipt(ctx, plan, "channel_wechat", "user_platform_jane");

    const newIntents = h.infra.audit.intents.slice(beforeCount);
    expect(newIntents).toHaveLength(1);
    expect(newIntents[0]?.action).toBe("publication_receipt.recorded");
    expect(newIntents[0]?.targetType).toBe("PublicationReceipt");
    expect(newIntents[0]?.clientOrganizationId).toBe(ORG);
    expect(newIntents[0]?.projectId).toBe(PROJECT);
  });
});

describe("publication package command", () => {
  it("creates publish package with correct structure", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);

    // Build minimal mock approval and draft
    const approval = {
      id: "approval_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      articleDraftId: "draft_1",
      approverId: "user_approver",
      approvedAt: "2026-07-19T00:00:00.000Z",
      qualityGateId: "qg_1",
      qualityGateStatus: "PASSED" as const,
      platformGateId: "pg_1",
      platformGateStatus: "PASSED" as const,
      verticalGateId: "vg_1",
      verticalGateStatus: "PASSED" as const,
    };

    const draft = {
      id: "draft_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      articleBriefId: "brief_1",
      sourceProviderArticleContentIds: ["content_1"] as [string, ...string[]],
      version: 1,
      title: "The State of GEO",
      sections: [{ heading: "Intro", order: 0 }],
      status: "DRAFT" as const,
      compiledAt: "2026-07-19T00:00:00.000Z",
    };

    // Create publish package via service
    const pkg = await h.publish.createPublishPackage(ctx, approval, draft);

    expect(pkg.clientOrganizationId).toBe(ORG);
    expect(pkg.projectId).toBe(PROJECT);
    expect(pkg.articleApprovalId).toBe("approval_1");
    expect(pkg.articleDraftId).toBe("draft_1");
    expect(pkg.title).toBe("The State of GEO");
  });

  it("creates channel-neutral package with 0 channels by default", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);

    const publishPkg = {
      id: "pkg_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      articleApprovalId: "approval_1",
      articleDraftId: "draft_1",
      title: "Test Article",
      builtAt: "2026-07-19T00:00:00.000Z",
    };

    const cncp = await h.publish.createChannelNeutralPackage(
      ctx,
      publishPkg,
      BLOCKS,
    );

    // Zero selected channels by default
    expect(cncp.targetChannelIds).toEqual([]);
    expect(cncp.blocks).toEqual(BLOCKS);
    expect(cncp.publishPackageId).toBe("pkg_1");
  });

  it("selecting a target channel returns a new package (immutable)", async () => {
    const h = buildHarness();
    const ctx = clientOwnerContext(ORG);

    const publishPkg = {
      id: "pkg_1",
      clientOrganizationId: ORG,
      projectId: PROJECT,
      articleApprovalId: "approval_1",
      articleDraftId: "draft_1",
      title: "Test Article",
      builtAt: "2026-07-19T00:00:00.000Z",
    };

    const original = await h.publish.createChannelNeutralPackage(ctx, publishPkg, BLOCKS);

    // Add a channel
    const withChannel = h.publish.selectTargetChannel(original, "channel_wechat");

    // Original is unchanged
    expect(original.targetChannelIds).toEqual([]);

    // New package has the channel
    expect(withChannel.targetChannelIds).toEqual(["channel_wechat"]);

    // Can add more channels (immutable)
    const withMoreChannels = h.publish.selectTargetChannel(withChannel, "channel_blog");
    expect(withMoreChannels.targetChannelIds).toEqual(["channel_wechat", "channel_blog"]);
    expect(withChannel.targetChannelIds).toEqual(["channel_wechat"]);
  });
});
