import { describe, expect, it } from "vitest";
import {
  CHINA_AI_PROBE_REGISTRY,
  getProbePlatform,
  isActiveProbePlatform,
} from "../../../src/runtime/probes/registry.js";

describe("China AI probe registry", () => {
  it("activates the four frozen P0 platforms and reserves two future entries", () => {
    expect(CHINA_AI_PROBE_REGISTRY.filter((item) => item.status === "ACTIVE").map((item) => item.code))
      .toEqual(["DOUBAO", "QWEN", "DEEPSEEK", "YUANBAO"]);
    expect(CHINA_AI_PROBE_REGISTRY.filter((item) => item.status === "RESERVED").map((item) => item.code))
      .toEqual(["KIMI", "WENXIN"]);
  });

  it("permits manual samples only and exposes no provider or automation configuration", () => {
    for (const item of CHINA_AI_PROBE_REGISTRY) {
      expect(item.allowedCollectionModes).toEqual(["MANUAL_SAMPLE"]);
      expect(Object.keys(item)).toEqual(["code", "displayName", "status", "allowedCollectionModes"]);
    }
    expect(isActiveProbePlatform("DOUBAO")).toBe(true);
    expect(isActiveProbePlatform("KIMI")).toBe(false);
    expect(getProbePlatform("UNKNOWN")).toBeUndefined();
  });
});
