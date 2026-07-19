import { describe, expect, it } from "vitest";
import { DeterministicOfflineExpansionAdapter, KeywordExpansionService, MemoryExpansionRepository } from "../../../src/runtime/keyword-expansion/offline-runtime.js";

const request = {
  clientOrganizationId: "c", projectId: "p", requestedByUserId: "u", reason: "人工审核前的离线组合",
  groups: [
    { type: "REGION" as const, values: ["上海"] }, { type: "PREFIX" as const, values: ["专业"] },
    { type: "MAIN" as const, values: ["牙科", "口腔诊所"] }, { type: "SUFFIX" as const, values: ["服务"] },
    { type: "RECOMMENDATION" as const, values: ["推荐"] },
  ],
};

describe("deterministic offline keyword expansion", () => {
  it("produces stable previews with provenance and no demand facts", () => {
    const adapter = new DeterministicOfflineExpansionAdapter();
    const first = adapter.preview(request, "2026-07-19T00:00:00Z");
    const second = adapter.preview(request, "2026-07-19T00:00:00Z");
    expect(first).toEqual(second);
    expect(first.candidates).toHaveLength(2);
    expect(first.candidates.every((item) => item.status === "NEEDS_HUMAN_REVIEW")).toBe(true);
    expect(first.candidates[0]?.provenance.generator).toBe("DETERMINISTIC_OFFLINE");
    expect(JSON.stringify(first)).not.toMatch(/searchVolume|competition|demandStatus|ranking/);
  });

  it("supports one append-only manual confirm or delete decision", async () => {
    const repo = new MemoryExpansionRepository();
    const service = new KeywordExpansionService(repo, undefined, () => new Date("2026-07-19T00:00:00Z"));
    const batch = await service.preview(request);
    const id = batch.candidates[0]!.id;
    expect((await service.confirm(id, "reviewer", "符合业务范围")).status).toBe("CONFIRMED");
    await expect(service.delete(id, "reviewer", "改为删除")).rejects.toThrow("already reviewed");
  });

  it("allows the same reviewed business input to start a later independent batch", () => {
    const adapter = new DeterministicOfflineExpansionAdapter();
    const first = adapter.preview(request, "2026-07-19T00:00:00Z");
    const later = adapter.preview(request, "2026-07-19T00:01:00Z");
    expect(later.id).not.toBe(first.id);
    expect(later.candidates[0]?.id).not.toBe(first.candidates[0]?.id);
  });

  it("rejects malformed or excessively large previews before persistence", () => {
    const adapter = new DeterministicOfflineExpansionAdapter();
    expect(() => adapter.preview({ ...request, groups: [{ type: "MAIN", values: Array.from({ length: 51 }, (_, index) => `词${index}`) }] }, "2026-07-19T00:00:00Z")).toThrow("invalid");
    expect(() => adapter.preview({ ...request, groups: [
      { type: "MAIN", values: Array.from({ length: 50 }, (_, index) => `核心${index}`) },
      { type: "SUFFIX", values: Array.from({ length: 11 }, (_, index) => `用途${index}`) },
    ] }, "2026-07-19T00:00:00Z")).toThrow("exceeds 500");
  });
});
