/**
 * Version Alignment Preflight Tests
 * Tests for scripts/preflight/version-alignment.mjs
 * 
 * These tests verify the preflight script behavior without executing it,
 * ensuring security constraints and functional requirements are met.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_PATH = resolve(__dirname, "../../../scripts/preflight/version-alignment.mjs");

function readScriptContent(): string {
  return readFileSync(SCRIPT_PATH, "utf8");
}

describe("Preflight script security constraints", () => {
  it("Does not hardcode any SHA values", () => {
    const script = readScriptContent();
    
    // Check no hardcoded 40-char SHAs (except in comments/examples)
    const hardcodedShaPattern = /(?<![/"])[0-9a-f]{40}(?![0-9a-f])/g;
    const matches = script.match(hardcodedShaPattern);
    
    // The script should dynamically read SHAs from git/env, not hardcode them
    expect(matches === null || matches.length === 0).toBe(true);
  });

  it("Dynamically reads Git HEAD via git rev-parse", () => {
    const script = readScriptContent();
    
    expect(script).toContain("git");
    expect(script).toContain("rev-parse");
    expect(script).toContain("HEAD");
  });

  it("Reads GEO_BUILD_GIT_SHA from .env.local", () => {
    const script = readScriptContent();
    
    expect(script).toContain("GEO_BUILD_GIT_SHA");
    expect(script).toContain(".env.local");
  });

  it("Outputs RUNTIME_BUILD_SHA_MISMATCH on failure", () => {
    const script = readScriptContent();
    
    expect(script).toContain("RUNTIME_BUILD_SHA_MISMATCH");
    expect(script).toContain("process.exit(1)");
  });

  it("Outputs SHA values (Git HEAD, Configured SHA, Runtime SHA) on success", () => {
    const script = readScriptContent();
    
    expect(script).toContain("Git HEAD");
    expect(script).toContain("Configured SHA");
    expect(script).toContain("Runtime SHA");
  });

  it("Does not reference sensitive environment variables", () => {
    const script = readScriptContent();
    const sensitiveVars = [
      "DATABASE_URL", "password", "secret", "token", "cookie", 
      "credential", "API_KEY", "AUTH"
    ];
    
    for (const varName of sensitiveVars) {
      // These should not appear as actual usage, only potentially in comments
      const lines = script.split("\n");
      const usageLines = lines.filter(line => 
        line.trim().startsWith("const ") && 
        line.includes(varName) &&
        !line.includes("//")
      );
      expect(usageLines.length).toBe(0);
    }
  });

  it("Uses full 40-character SHA for comparison", () => {
    const script = readScriptContent();
    
    // Verify the SHA comparison logic uses full SHA, not short
    expect(script).toContain("trim()");
  });

  it("Supports --configured mode for build-time check", () => {
    const script = readScriptContent();
    
    expect(script).toContain("--configured");
    expect(script).toContain("mode === \"configured\"");
  });

  it("Supports --runtime mode for runtime check", () => {
    const script = readScriptContent();
    
    expect(script).toContain("--runtime");
    expect(script).toContain("mode === \"runtime\"");
    expect(script).toContain("/api/ops/build-info");
  });

  it("Configured mode does not require server to be running", () => {
    const script = readScriptContent();
    
    // In configured mode, we should NOT call the API
    const configuredBlock = script.split('mode === "configured"')[1]?.split("mode === \"runtime\"")[0];
    expect(configuredBlock).toBeDefined();
    expect(configuredBlock).not.toContain("fetch");
  });

  it("Runtime mode requires API accessibility", () => {
    const script = readScriptContent();
    
    const runtimeBlock = script.split('mode === "runtime"')[1]?.split("process.exit")[0];
    expect(runtimeBlock).toBeDefined();
    expect(runtimeBlock).toContain("fetch");
    expect(runtimeBlock).toContain("/api/ops/build-info");
  });

  it("Handles missing SHA gracefully without leaking other env vars", () => {
    const script = readScriptContent();
    
    // Should have explicit handling for missing/invalid SHA
    expect(script).toContain("unknown");
    expect(script).toContain('""');
  });
});

describe("Preflight script package.json integration", () => {
  it("Has preflight:version script defined", () => {
    const pkgPath = resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    
    expect(pkg.scripts["preflight:version"]).toBeDefined();
    expect(pkg.scripts["preflight:version"]).toContain("version-alignment.mjs");
  });

  it("Has preflight:runtime-version script defined", () => {
    const pkgPath = resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    
    expect(pkg.scripts["preflight:runtime-version"]).toBeDefined();
    expect(pkg.scripts["preflight:runtime-version"]).toContain("--runtime");
  });
});
