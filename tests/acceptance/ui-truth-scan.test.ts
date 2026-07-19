import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanUiTruthEvidence } from "../../scripts/acceptance/ui-truth-scan-lib.mjs";

function evidence(overrides: { page?: string; account?: unknown; capabilities?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-ui-truth-"));
  mkdirSync(join(root, "rendered"));
  mkdirSync(join(root, "accounts"));
  writeFileSync(join(root, "rendered", "client-overview.txt"), overrides.page ?? "国内 GEO 运营与交付系统 内容与交付");
  writeFileSync(join(root, "accounts", "safe.json"), JSON.stringify(overrides.account ?? { accounts: [{ displayName: "内容账号一", status: "READY" }] }));
  writeFileSync(join(root, "capabilities.json"), JSON.stringify(overrides.capabilities ?? { capabilities: [{ id: "account-center", apiWiring: true, usableCapability: true, evidence: ["account-http"] }] }));
  return root;
}

describe("UI truth acceptance scanner", () => {
  it("keeps API wiring and usable capability as independent counts", () => {
    const root = evidence({ capabilities: { capabilities: [
      { id: "wired-only", apiWiring: true, usableCapability: false, evidence: [] },
      { id: "usable", apiWiring: true, usableCapability: true, evidence: ["browser-write-read"] },
    ] } });
    const report = scanUiTruthEvidence(root);
    expect(report.decision).toBe("PASS");
    expect(report.counts.apiWiring).toBe(2);
    expect(report.counts.usableCapabilities).toBe(1);
  });

  it("rejects fixture language, stale product terms, broad stubs, and secret account fields", () => {
    const root = evidence({
      page: "Sample Local Client Pilot Fixture 国内 AI 查询 内容与信源 该功能尚未开放",
      account: { accounts: [{ displayName: "账号", credentialRef: "do-not-expose" }] },
    });
    writeFileSync(join(root, "rendered", "ops-overview.txt"), "国内 GEO 运营与交付系统 该功能尚未开放");
    const report = scanUiTruthEvidence(root);
    expect(report.decision).toBe("FAIL");
    expect(report.failures.join("\n")).toMatch(/测试\/演示数据|内容与信源|秘密字段|占位页|术语未统一/);
  });

  it("requires evidence before a capability can be counted as usable", () => {
    const report = scanUiTruthEvidence(evidence({ capabilities: { capabilities: [
      { id: "unproven", apiWiring: true, usableCapability: true, evidence: [] },
    ] } }));
    expect(report.decision).toBe("FAIL");
    expect(report.failures).toContain("unproven: 用户可用能力缺少证据。");
  });
});
