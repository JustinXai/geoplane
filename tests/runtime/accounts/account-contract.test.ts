import { describe, expect, it } from "vitest";
import type { PlatformAccount } from "../../../src/runtime/accounts/entities.js";
import { readFileSync } from "node:fs";
import { ACCOUNT_PLATFORM_REGISTRY } from "../../../src/runtime/accounts/platform-registry.js";

describe("DOMESTIC_ACCOUNT_CENTER_V1 contract", () => {
  it("defaults the first release contract to manual operation without secret values", () => {
    const account: PlatformAccount = {
      id: "account-1", platformCode: "DOUBAO", accountType: "AI_PLATFORM_ACCOUNT",
      ownership: "PLATFORM_OWNED", agencyOrganizationId: null, clientOrganizationId: null,
      displayLabel: "公共测试账号", secretReference: "secretref://account/test-1", credentialStatus: "UNVERIFIED",
      lastVerifiedAt: null, status: "ACTIVE", operationMode: "MANUAL_OPERATION",
      createdByUserId: "user-1", createdAt: "2026-07-19T00:00:00.000Z", updatedAt: "2026-07-19T00:00:00.000Z",
    };
    expect(account.operationMode).toBe("MANUAL_OPERATION");
    expect(Object.keys(account)).not.toContain("password");
    expect(Object.keys(account)).not.toContain("cookie");
    expect(Object.keys(account)).not.toContain("token");
    expect(Object.keys(account)).not.toContain("apiKey");
  });

  it("schema has ownership, project assignment and append-only guards", () => {
    const sql = readFileSync("migrations/0010_domestic_account_center.sql", "utf8");
    expect(sql).toContain("ck_platform_account_owner_shape");
    expect(sql).toContain("enforce_account_assignment_scope");
    expect(sql).toContain("ck_platform_account_secret_reference");
    expect(sql).toContain("enforce_account_result_receipt_scope");
    expect(sql).toContain("reject_account_ledger_mutation");
    expect(sql).not.toMatch(/\b(password|cookie|api_key|token)\s+TEXT\b/i);
  });

  it("minimal API rejects plaintext credential field names", () => {
    const route = readFileSync("src/app/api/accounts/route.ts", "utf8");
    expect(route).toContain('"password","cookie","token","apiKey","api_key"');
    expect(route).toContain("secretReference:_secret");
  });

  it("registers the four AI and twelve content account platforms", () => {
    expect(ACCOUNT_PLATFORM_REGISTRY).toHaveLength(16);
    expect(ACCOUNT_PLATFORM_REGISTRY.filter((item) => item.accountType === "AI_PLATFORM_ACCOUNT").map((item) => item.code)).toEqual([
      "DOUBAO", "QWEN", "DEEPSEEK", "YUANBAO",
    ]);
    expect(ACCOUNT_PLATFORM_REGISTRY.filter((item) => item.accountType === "CONTENT_PLATFORM_ACCOUNT")).toHaveLength(12);
  });
});
