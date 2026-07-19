import { describe, expect, it } from "vitest";
import { EXPANSION_GROUP_TYPES, FORBIDDEN_EXPANSION_DEMAND_FIELDS } from "../../../src/runtime/keyword-expansion/contract.js";

describe("AI keyword expansion recovery contract", () => {
  it("freezes all six combination groups", () => {
    expect(EXPANSION_GROUP_TYPES).toEqual(["PREFIX", "MAIN", "SUFFIX", "RECOMMENDATION", "QUESTION", "REGION"]);
  });

  it("names demand fields that the expansion runtime must never fabricate", () => {
    expect(FORBIDDEN_EXPANSION_DEMAND_FIELDS).toContain("searchVolume");
    expect(FORBIDDEN_EXPANSION_DEMAND_FIELDS).toContain("demandStatus");
  });
});
