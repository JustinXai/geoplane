/**
 * Unit tests for OfflineDraftGenerator.
 *
 * Tests:
 * 1. ArticleBrief → Draft works offline (without provider)
 * 2. Draft is persisted correctly to the repository
 * 3. Brief↔Draft relationship is correct
 * 4. Provider content is ingested with offline envelope
 * 5. Version increments correctly for multiple drafts
 * 6. Tenant isolation is enforced
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { ArticleBrief, ArticleBriefPlanningContextV1 } from "../../../src/contracts/geo-business/entities.js";
import { buildHarness, clientOwnerContext, ORG, PROJECT } from "./fakes.js";
import type { Harness } from "./fakes.js";

const CLIENT_ORG = ORG;
const PROJECT_ID = PROJECT;

function makeBrief(overrides: Partial<ArticleBrief> = {}): ArticleBrief {
  const planningContext: ArticleBriefPlanningContextV1 = {
    schemaVersion: "ArticleBriefPlanningContextV1",
    opportunityFamilyId: "fam_test_001",
    authorizingHumanReviewDecisionIds: ["hrd_test_001"],
    targetKeywords: ["test keyword 1", "test keyword 2"],
    riskLevel: "STANDARD",
  };

  return {
    id: "brief_test_001",
    clientOrganizationId: CLIENT_ORG,
    projectId: PROJECT_ID,
    opportunityFamilyId: "fam_test_001",
    planningContext,
    workingTitle: "Test Article: How to Do X",
    outline: [
      "What is X?",
      "How does X work?",
      "Why use X?",
      "X vs alternatives",
    ],
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("OfflineDraftGenerator", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness("id");
  });

  describe("generateDraft", () => {
    it("creates an ArticleDraft from an ArticleBrief without any provider call", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      // Track that no provider calls were made
      const callCountBefore = harness.provider.callCount;

      const result = await harness.offline.generateDraft(actor, { brief });

      // Verify the draft was created
      expect(result.draft).toBeDefined();
      expect(result.draft.id).toBe("id_2"); // First id for provider content, second for draft
      expect(result.draft.status).toBe("DRAFT");
      expect(result.draft.articleBriefId).toBe(brief.id);
      expect(result.draft.title).toBe(brief.workingTitle);
      expect(result.draft.clientOrganizationId).toBe(CLIENT_ORG);
      expect(result.draft.projectId).toBe(PROJECT_ID);

      // Verify no provider calls were made
      expect(harness.provider.callCount).toBe(callCountBefore);
    });

    it("creates sections from the brief's outline", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      // Sections should match the outline
      expect(draft.sections).toHaveLength(brief.outline.length);
      expect(draft.sections[0]?.heading).toBe(brief.outline[0]);
      expect(draft.sections[0]?.order).toBe(0);
      expect(draft.sections[1]?.heading).toBe(brief.outline[1]);
      expect(draft.sections[1]?.order).toBe(1);
      expect(draft.sections[2]?.heading).toBe(brief.outline[2]);
      expect(draft.sections[2]?.order).toBe(2);
      expect(draft.sections[3]?.heading).toBe(brief.outline[3]);
      expect(draft.sections[3]?.order).toBe(3);
    });

    it("persists the draft to the repository", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      // Verify draft can be retrieved from repository
      const retrieved = await harness.articleDraftRepo.getById(draft.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(draft.id);
      expect(retrieved!.status).toBe("DRAFT");
      expect(retrieved!.articleBriefId).toBe(brief.id);
    });

    it("creates provider content with offline envelope ID", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { providerContent } = await harness.offline.generateDraft(actor, { brief });

      // Verify provider content was created
      expect(providerContent).toBeDefined();
      expect(providerContent.id).toBe("id_1"); // First id
      expect(providerContent.articleBriefId).toBe(brief.id);
      expect(providerContent.providerResponseEnvelopeId).toContain("offline_envelope_");
      expect(providerContent.providerResponseEnvelopeId).toContain(brief.id);
      expect(providerContent.clientOrganizationId).toBe(CLIENT_ORG);
      expect(providerContent.projectId).toBe(PROJECT_ID);

      // Verify provider content exists in the list
      const allContents = await harness.providerContentRepo.listByArticleBrief(brief.id);
      expect(allContents.some(c => c.id === providerContent.id)).toBe(true);
    });

    it("links draft to the provider content via sourceProviderArticleContentIds", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft, providerContent } = await harness.offline.generateDraft(actor, { brief });

      // Draft should reference the provider content
      expect(draft.sourceProviderArticleContentIds).toHaveLength(1);
      expect(draft.sourceProviderArticleContentIds[0]).toBe(providerContent.id);
    });

    it("assigns version 1 for the first draft of a brief", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      expect(draft.version).toBe(1);
    });

    it("increments version for subsequent drafts of the same brief", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      // Generate first draft
      const { draft: draft1 } = await harness.offline.generateDraft(actor, { brief });
      expect(draft1.version).toBe(1);

      // Generate second draft
      const { draft: draft2 } = await harness.offline.generateDraft(actor, { brief });
      expect(draft2.version).toBe(2);

      // Generate third draft
      const { draft: draft3 } = await harness.offline.generateDraft(actor, { brief });
      expect(draft3.version).toBe(3);
    });

    it("enforces tenant isolation by rejecting cross-tenant access", async () => {
      const brief = makeBrief({ clientOrganizationId: "other_org" });
      const actor = clientOwnerContext(CLIENT_ORG);

      await expect(harness.offline.generateDraft(actor, { brief })).rejects.toThrow();
    });

    it("supports custom offline envelope label", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      const { providerContent } = await harness.offline.generateDraft(actor, {
        brief,
        offlineEnvelopeLabel: "custom_label",
      });

      expect(providerContent.providerResponseEnvelopeId).toContain("custom_label");
    });

    it("emits audit events for both provider content ingestion and draft compilation", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      await harness.offline.generateDraft(actor, { brief });

      // Check audit intents were recorded
      expect(harness.infra.audit.intents).toHaveLength(2);
      expect(harness.infra.audit.intents[0]!.action).toBe("provider_article_content.ingested.offline");
      expect(harness.infra.audit.intents[1]!.action).toBe("article_draft.compiled.offline");
    });
  });

  describe("Brief↔Draft relationship", () => {
    it("draft references the source brief by ID", async () => {
      const brief = makeBrief({ id: "brief_unique_001" });
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      expect(draft.articleBriefId).toBe(brief.id);
    });

    it("draft title matches brief workingTitle", async () => {
      const brief = makeBrief({ workingTitle: "My Custom Title" });
      const actor = clientOwnerContext(CLIENT_ORG);

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      expect(draft.title).toBe(brief.workingTitle);
    });

    it("draft carries forward brief's tenant context", async () => {
      const brief = makeBrief({
        clientOrganizationId: "tenant_xyz",
        projectId: "proj_xyz",
      });
      const actor = clientOwnerContext("tenant_xyz");

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      expect(draft.clientOrganizationId).toBe(brief.clientOrganizationId);
      expect(draft.projectId).toBe(brief.projectId);
    });
  });

  describe("compiledAt timestamp", () => {
    it("sets compiledAt to current clock time", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      // Set the clock to a known time
      harness.infra.clock.set(new Date("2026-07-20T12:00:00.000Z"));

      const { draft } = await harness.offline.generateDraft(actor, { brief });

      expect(draft.compiledAt).toBe("2026-07-20T12:00:00.000Z");
    });

    it("increments compiledAt for subsequent drafts", async () => {
      const brief = makeBrief();
      const actor = clientOwnerContext(CLIENT_ORG);

      // Set initial clock
      harness.infra.clock.set(new Date("2026-07-20T12:00:00.000Z"));
      const { draft: draft1 } = await harness.offline.generateDraft(actor, { brief });
      expect(draft1.compiledAt).toBe("2026-07-20T12:00:00.000Z");

      // Advance clock
      harness.infra.clock.set(new Date("2026-07-20T12:01:00.000Z"));
      const { draft: draft2 } = await harness.offline.generateDraft(actor, { brief });
      expect(draft2.compiledAt).toBe("2026-07-20T12:01:00.000Z");
    });
  });
});
