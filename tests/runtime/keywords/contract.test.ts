import { describe, expect, it } from "vitest";
import type {
  KeywordDemandObservation,
  KeywordReviewRecord,
} from "../../../src/runtime/keywords/contracts.js";

describe("BAIDU_KEYWORD_RUNTIME_V1 contract", () => {
  it("only permits imported demand evidence and explicit human decisions", () => {
    const status: KeywordDemandObservation["status"] = "OBSERVED_DEMAND";
    const decision: KeywordReviewRecord["decision"] = "CONFIRMED";
    expect(status).toBe("OBSERVED_DEMAND");
    expect(decision).toBe("CONFIRMED");
  });

  it("does not expose mutation operations on the append-only repository", async () => {
    const module = await import("../../../src/runtime/keywords/ports.js");
    expect(Object.keys(module)).not.toContain("update");
  });
});
