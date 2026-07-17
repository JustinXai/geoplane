/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation"),
 *   the frozen checkpoint C3 spec requirement that every agency-acting-for-client
 *   screen carry a visible, unmissable banner ("代理商代客户操作有醒目 Banner"),
 *   src/components/agency/agency-acting-banner.tsx
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C3 compliance test: confirms the shared AgencyActingBanner component is
 * actually imported and rendered on at least the two agency-workspace pages that most
 * need it (client projects, delivery packages), not just documented as a requirement.
 * No JSX/DOM render pipeline is configured in this test environment yet (this repo has
 * no @testing-library or vite React plugin dependency), so - matching the style of
 * tests/client-workspace-copy.test.ts, which pattern-checks plain strings rather than
 * rendering anything - this is a source-level presence check, not a full render.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const PAGES_REQUIRING_BANNER = [
  "../src/app/agency/projects/page.tsx",
  "../src/app/agency/deliveries/page.tsx",
];

describe("AgencyActingBanner presence (checkpoint C3)", () => {
  it("the shared component module exports AgencyActingBanner", () => {
    const source = readSource("../src/components/agency/agency-acting-banner.tsx");
    expect(source).toMatch(/export function AgencyActingBanner/);
  });

  for (const page of PAGES_REQUIRING_BANNER) {
    it(`${page} imports AgencyActingBanner from the shared component`, () => {
      const source = readSource(page);
      expect(source).toMatch(
        /import\s*\{\s*AgencyActingBanner\s*\}\s*from\s*["']@\/components\/agency\/agency-acting-banner["']/,
      );
    });

    it(`${page} actually renders <AgencyActingBanner`, () => {
      const source = readSource(page);
      expect(source).toMatch(/<AgencyActingBanner\b/);
    });
  }
});
