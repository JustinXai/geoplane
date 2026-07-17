import { describe, expect, it } from "vitest";
import { SCAFFOLD_VERSION } from "../src/index.js";

describe("P0 scaffold", () => {
  it("exposes a scaffold version marker", () => {
    expect(SCAFFOLD_VERSION).toBe("P0_PROJECT_SCAFFOLD_V1");
  });
});
