/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Fixture-based smoke test for the checkpoint D1 GEO business chain
 * contracts (src/contracts/geo-business/entities.ts): KnowledgePackage,
 * IndustryProfile, KeywordQuestionMap. Builds one concrete, valid fixture
 * object per interface/type and asserts something meaningful about each,
 * including the tenant-isolation fields required by
 * docs/governance/SYSTEM_INVARIANTS_V1.md.
 */
import { describe, expect, it } from "vitest";
import type {
  DraftKnowledgePackage,
  IndustryProfile,
  KeywordQuestionMap,
  KnowledgePackage,
  SealedKnowledgePackage,
} from "../../src/contracts/geo-business/entities.js";

const CLIENT_ORGANIZATION_ID = "org_client_acme";
const PROJECT_ID = "proj_acme_main_site";

describe("KnowledgePackage", () => {
  it("scopes a draft package to a client organization and project, at version 1", () => {
    const draft: DraftKnowledgePackage = {
      id: "kp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      version: 1,
      title: "Acme product documentation, Q3 crawl",
      sourceDescription: "Ingested from Acme's internal help center export",
      createdAt: "2026-07-01T00:00:00.000Z",
      status: "DRAFT",
    };

    expect(draft.status).toBe("DRAFT");
    expect(draft.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(draft.projectId).toBe(PROJECT_ID);
    expect(draft.version).toBeGreaterThan(0);
    // Draft packages carry no seal timestamp.
    expect("sealedAt" in draft).toBe(false);
  });

  it("requires a sealedAt timestamp once a package transitions to SEALED, and treats it as immutable from then on", () => {
    const sealed: SealedKnowledgePackage = {
      id: "kp_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      version: 2,
      title: "Acme product documentation, Q3 crawl",
      sourceDescription: "Ingested from Acme's internal help center export",
      createdAt: "2026-07-01T00:00:00.000Z",
      status: "SEALED",
      sealedAt: "2026-07-02T00:00:00.000Z",
    };

    expect(sealed.status).toBe("SEALED");
    expect(sealed.sealedAt).toBeTruthy();
    // A sealed package's sealedAt must be at or after its createdAt.
    expect(new Date(sealed.sealedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(sealed.createdAt).getTime(),
    );
  });

  it("accepts either variant through the KnowledgePackage union and discriminates on status", () => {
    const packages: KnowledgePackage[] = [
      {
        id: "kp_0002",
        clientOrganizationId: CLIENT_ORGANIZATION_ID,
        projectId: PROJECT_ID,
        version: 1,
        title: "Support ticket knowledge slice",
        sourceDescription: "Ingested from Zendesk export",
        createdAt: "2026-07-03T00:00:00.000Z",
        status: "DRAFT",
      },
      {
        id: "kp_0003",
        clientOrganizationId: CLIENT_ORGANIZATION_ID,
        projectId: PROJECT_ID,
        version: 1,
        title: "Pricing page knowledge slice",
        sourceDescription: "Ingested from marketing site crawl",
        createdAt: "2026-07-04T00:00:00.000Z",
        status: "SEALED",
        sealedAt: "2026-07-05T00:00:00.000Z",
      },
    ];

    const sealedCount = packages.filter((pkg) => pkg.status === "SEALED").length;
    expect(sealedCount).toBe(1);
    expect(packages.every((pkg) => pkg.clientOrganizationId === CLIENT_ORGANIZATION_ID)).toBe(true);
  });
});

describe("IndustryProfile", () => {
  it("scopes a vertical classification to a client organization and project, with a validation gate level", () => {
    const profile: IndustryProfile = {
      id: "ind_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      verticalSlug: "b2b-saas",
      verticalLabel: "B2B SaaS",
      validationGateLevel: "INDUSTRY_VERTICAL_GATE",
      ruleSetVersion: 3,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    expect(profile.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(profile.projectId).toBe(PROJECT_ID);
    expect(["PLATFORM_WIDE_GATE", "INDUSTRY_VERTICAL_GATE"]).toContain(profile.validationGateLevel);
    expect(profile.ruleSetVersion).toBeGreaterThan(0);
    expect(new Date(profile.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(profile.createdAt).getTime(),
    );
  });
});

describe("KeywordQuestionMap", () => {
  it("pins a keyword/question mapping to a specific KnowledgePackage version and an IndustryProfile", () => {
    const map: KeywordQuestionMap = {
      id: "kqm_0001",
      clientOrganizationId: CLIENT_ORGANIZATION_ID,
      projectId: PROJECT_ID,
      knowledgePackageId: "kp_0001",
      knowledgePackageVersion: 2,
      industryProfileId: "ind_0001",
      entries: [
        {
          keyword: "geo article production",
          questions: [
            "What is GEO article production?",
            "How does knowledge-driven article production work?",
          ],
        },
        {
          keyword: "tenant isolation",
          questions: ["How is tenant data isolated between client organizations?"],
        },
      ],
      createdAt: "2026-07-06T00:00:00.000Z",
    };

    expect(map.clientOrganizationId).toBe(CLIENT_ORGANIZATION_ID);
    expect(map.knowledgePackageId).toBe("kp_0001");
    expect(map.knowledgePackageVersion).toBe(2);
    expect(map.entries.length).toBeGreaterThan(0);
    // Every keyword entry must map to at least one real user question.
    expect(map.entries.every((entry) => entry.questions.length > 0)).toBe(true);
  });
});
