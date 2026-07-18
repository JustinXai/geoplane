/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — client-surface leak check.
 *
 * The frozen View DTOs carry stable-but-internal ids (userId / organizationId / projectId /
 * packageId / issue id / delivery id, all UUIDs). This suite feeds every mapper a DTO whose
 * internal ids are real UUIDs and asserts the serialized display view-model exposes NONE of
 * them, nor any forbidden internal vocabulary (UUID / Hash / Provider / Schema / Candidate /
 * Brief / Artifact) — client screens must show only human-facing fields.
 */
import { describe, expect, it } from "vitest";
import type {
  AccountViewV1,
  ArticleDeliveryViewV1,
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
  OpportunityViewV1,
  ProjectViewV1,
} from "../../../src/runtime/api-contracts/index.js";
import {
  toAccountSummary,
  toDeliveryRows,
  toKnowledgeIssueRows,
  toKnowledgePackageReadiness,
  toOpportunityRows,
  toProjectOptions,
  toProjectSummary,
} from "../../../src/components/client-runtime/view-models.js";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Forbidden internal vocabulary that must never reach a client-facing view-model.
const FORBIDDEN_TERMS = [
  "hash",
  "provider",
  "schema",
  "candidate",
  "brief",
  "artifact",
  "chunk",
  "embedding",
];

// Forbidden object keys (internal identifiers) that must never appear in a view-model.
const FORBIDDEN_KEYS = new Set([
  "id",
  "userId",
  "projectId",
  "packageId",
  "organizationId",
  "clientOrganizationId",
  "activeClientOrganizationId",
  "subjectId",
]);

const UUID_A = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const UUID_B = "2c5f39cb-3fb2-22e3-994f-1127e4ddb538";

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function assertNoLeak(label: string, vm: unknown): void {
  const serialized = JSON.stringify(vm);
  expect(serialized, `${label}: leaked a UUID`).not.toMatch(UUID_PATTERN);

  const lowered = serialized.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(lowered.includes(term), `${label}: leaked forbidden term "${term}"`).toBe(false);
  }

  for (const key of collectKeys(vm)) {
    expect(FORBIDDEN_KEYS.has(key), `${label}: leaked forbidden key "${key}"`).toBe(false);
  }
}

const account: AccountViewV1 = {
  userId: UUID_A,
  email: "owner@example.com",
  displayName: "客户负责人",
  role: "CLIENT_OWNER",
  surface: "client",
  organizationId: UUID_B,
  organizationName: "示例企业",
  organizationType: "CLIENT",
  activeClientOrganizationId: UUID_A,
};

const project: ProjectViewV1 = {
  id: UUID_A,
  name: "示例项目",
  clientOrganizationId: UUID_B,
  clientOrganizationName: "示例企业",
  createdAt: "2026-07-10T00:00:00.000Z",
};

const pkg: KnowledgePackageViewV1 = {
  id: UUID_A,
  projectId: UUID_B,
  title: "产品功能总览",
  status: "CONFIRMED",
  documentCount: 3,
  openIssueCount: 0,
  updatedAt: "2026-07-12T00:00:00.000Z",
  confirmedAt: "2026-07-15T00:00:00.000Z",
};

const issue: KnowledgeIssueViewV1 = {
  id: UUID_A,
  packageId: UUID_B,
  kind: "UNVERIFIED_FACT",
  severity: "WARNING",
  message: "该数据需要核实来源",
  resolved: false,
};

const delivery: ArticleDeliveryViewV1 = {
  id: UUID_A,
  projectId: UUID_B,
  title: "企业知识库搭建指南",
  status: "DELIVERED",
  deliveredAt: "2026-07-16T00:00:00.000Z",
  publicationRegisteredAt: null,
};

const opportunity: OpportunityViewV1 = {
  id: UUID_A,
  projectId: UUID_B,
  title: "关键词内容方向",
  summary: "面向该关键词的内容方向。",
  status: "PROPOSED",
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("client-surface leak check — no UUID / internal id / vocabulary in any view-model", () => {
  it("sanity: the raw DTOs DO carry UUIDs (so the check is meaningful)", () => {
    expect(JSON.stringify(pkg)).toMatch(UUID_PATTERN);
    expect(JSON.stringify(delivery)).toMatch(UUID_PATTERN);
  });

  it("account summary", () => assertNoLeak("account", toAccountSummary(account)));
  it("project summary", () => assertNoLeak("project", toProjectSummary(project)));
  it("project options", () => assertNoLeak("projectOptions", toProjectOptions([project])));
  it("knowledge package readiness", () =>
    assertNoLeak("package", toKnowledgePackageReadiness(pkg)));
  it("knowledge issue rows", () => assertNoLeak("issues", toKnowledgeIssueRows([issue])));
  it("delivery rows", () => assertNoLeak("deliveries", toDeliveryRows([delivery])));
  it("opportunity rows", () => assertNoLeak("opportunities", toOpportunityRows([opportunity])));
});
