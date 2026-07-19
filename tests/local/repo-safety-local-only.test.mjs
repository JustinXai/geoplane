import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts", "repo-safety-preflight.mjs");

describe("repo safety preflight local-only posture", () => {
  it("passes using local facts without exposing or discussing remote state", () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: repoRoot,
      env: { ...process.env, LOCAL_ONLY_MODE: "true" },
      encoding: "utf8",
    });
    expect(output).toContain("repo:safety:preflight PASS (local-only)");
    expect(output).not.toMatch(/https?:\/\//i);
    expect(output).not.toMatch(/origin\//i);
    expect(output).not.toMatch(/push/i);
  });

  it("contains no git operation capable of network access", () => {
    const source = readFileSync(script, "utf8");
    expect(source).not.toContain('"remote"');
    expect(source).not.toContain('"fetch"');
    expect(source).not.toContain('"pull"');
    expect(source).not.toContain('"push"');
    expect(source).not.toContain('"ls-remote"');
  });
});
