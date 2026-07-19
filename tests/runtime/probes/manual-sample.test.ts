import { describe, expect, it } from "vitest";
import {
  ManualProbeService, ProbeValidationError, type RawProbeResult, type RawProbeResultRepository,
} from "../../../src/runtime/probes/manual-sample.js";

class MemoryRepo implements RawProbeResultRepository {
  readonly rows: RawProbeResult[] = [];
  async append(row: RawProbeResult) { this.rows.push(row); return row; }
  async listByProject(clientOrganizationId: string, projectId: string) {
    return this.rows.filter((r) => r.clientOrganizationId === clientOrganizationId && r.projectId === projectId);
  }
}

const base = {
  clientOrganizationId: "client-1", projectId: "project-1", platform: "DOUBAO",
  collectionMode: "MANUAL_SAMPLE" as const, question: "这个品牌值得推荐吗？",
  observedAt: "2026-07-19T02:00:00.000Z",
};

describe("manual probe sample runtime", () => {
  it("appends a manually observed answer with an opaque screenshot reference", async () => {
    const repo = new MemoryRepo();
    const service = new ManualProbeService(repo, () => new Date("2026-07-19T03:00:00Z"), () => "probe-1");
    const result = await service.record({ ...base, outcome: "ANSWERED", answerText: "  建议先核验资质。 ", screenshotReference: "evidence://probe/screen-1" }, "user-1");
    expect(result).toMatchObject({ id: "probe-1", outcome: "ANSWERED", answerText: "建议先核验资质。", failureCode: null, recordedByUserId: "user-1" });
    expect(repo.rows).toEqual([result]);
  });

  it("records a manual failure without inventing an answer", async () => {
    const service = new ManualProbeService(new MemoryRepo(), () => new Date(0), () => "probe-2");
    const result = await service.record({ ...base, platform: "QWEN", outcome: "FAILED", failureCode: "ANSWER_NOT_RETURNED", failureMessage: "页面未返回回答" }, "user-1");
    expect(result.answerText).toBeNull();
    expect(result.failureCode).toBe("ANSWER_NOT_RETURNED");
  });

  it("rejects reserved platforms, automatic modes, and incoherent outcomes", async () => {
    const service = new ManualProbeService(new MemoryRepo());
    await expect(service.record({ ...base, platform: "KIMI", outcome: "ANSWERED", answerText: "x" }, "u")).rejects.toBeInstanceOf(ProbeValidationError);
    await expect(service.record({ ...base, collectionMode: "AUTOMATED" as never, outcome: "ANSWERED", answerText: "x" }, "u")).rejects.toThrow("only MANUAL_SAMPLE");
    await expect(service.record({ ...base, outcome: "FAILED", answerText: "invented", failureCode: "OTHER" }, "u")).rejects.toThrow("forbids answerText");
  });
});
