import { describe, expect, it } from "vitest";
import type { PlatformAccount } from "../../../src/runtime/accounts/entities.js";
import { readFileSync } from "node:fs";
import { ACCOUNT_PLATFORM_REGISTRY } from "../../../src/runtime/accounts/platform-registry.js";
import { createHash } from "node:crypto";

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
    const hardening = readFileSync("migrations/0016_account_center_hardening.sql", "utf8");
    expect(sql).toContain("ck_platform_account_owner_shape");
    expect(sql).toContain("enforce_account_assignment_scope");
    expect(hardening).toContain("ck_platform_account_secret_reference");
    expect(hardening).toContain("enforce_account_result_receipt_scope");
    expect(sql).toContain("reject_account_ledger_mutation");
    expect(sql).not.toMatch(/\b(password|cookie|api_key|token)\s+TEXT\b/i);
  });

  it("keeps the checkpointed 0010 migration byte-for-byte immutable", () => {
    const bytes=readFileSync("migrations/0010_domestic_account_center.sql");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("c9fbb830d8fa4aaced5c36465f3a6bf0b35bed5f3fac1addde9cc4d5b073c285");
  });

  it("minimal API rejects plaintext credential field names", () => {
    const route = readFileSync("src/app/api/accounts/route.ts", "utf8");
    expect(route).toContain('"password","cookie","token","apiKey","api_key"');
    expect(route).toContain("secretReference:_secret");
  });

  it("account workspace exposes real filters, actionable empty state and no automatic platform action", () => {
    const panel = readFileSync("src/components/ops-runtime/OpsAccountReadPanel.tsx", "utf8");
    const page = readFileSync("src/app/ops/accounts/page.tsx", "utf8");
    expect(panel).toContain('type Filter="ALL"|"PLATFORM"|"ATTENTION"|"PENDING"|"FAILED"');
    expect(panel).toContain('href="#register-account"');
    expect(panel).toContain("authorizedProjects");
    expect(panel).toContain("lastCheckedAt");
    expect(page).toContain("当前不提供自动登录或真实平台调用");
  });

  it("registers the four AI and twelve content account platforms", () => {
    expect(ACCOUNT_PLATFORM_REGISTRY).toHaveLength(16);
    expect(ACCOUNT_PLATFORM_REGISTRY.filter((item) => item.accountType === "AI_PLATFORM_ACCOUNT").map((item) => item.code)).toEqual([
      "DOUBAO", "QWEN", "DEEPSEEK", "YUANBAO",
    ]);
    expect(ACCOUNT_PLATFORM_REGISTRY.filter((item) => item.accountType === "CONTENT_PLATFORM_ACCOUNT")).toHaveLength(12);
  });
});
