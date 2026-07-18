/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation"),
 *   the frozen checkpoint C3 spec requirement that every agency-acting-for-client
 *   screen carry a visible, unmissable banner ("代理商代客户操作有醒目 Banner"),
 *   src/components/agency-runtime/AgencyActingBanner.tsx
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C3 compliance test — realigned for AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1),
 * authorized by Agent A. When the agency workspace was wired to the real APIs, the acting-for-
 * client banner moved from a per-page fixture banner (@/components/agency/agency-acting-banner,
 * rendered inline on each page) to a PERSISTENT banner mounted ONCE in the shared agency shell:
 *
 *   AgencyActingBanner            (src/components/agency-runtime/AgencyActingBanner.tsx)
 *     ← rendered by AgencyActingBannerMount (…/AgencyActingBannerMount.tsx), which reads the
 *       shared acting-context store and shows the banner whenever the agency is acting for a client
 *       ← mounted once by the agency layout (src/app/agency/layout.tsx), the shared shell that
 *         EVERY agency page — including client projects and delivery packages — renders inside.
 *
 * This still enforces the invariant: it confirms the banner component is really imported and
 * rendered on the acting-for-client surface (now via the shared shell those pages use), not merely
 * documented. As before, no JSX/DOM render pipeline is configured here (this repo has no
 * @testing-library / vite React plugin), so — matching tests/client-workspace-copy.test.ts — this
 * is a source-level presence check, not a full render.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

// The two agency-workspace pages the C3 invariant most cares about. Both are ordinary pages under
// src/app/agency/, so Next renders each one INSIDE src/app/agency/layout.tsx — the shared shell
// that mounts the persistent banner below. They therefore carry the banner by construction.
const PAGES_COVERED_BY_SHARED_BANNER = [
  "../src/app/agency/projects/page.tsx",
  "../src/app/agency/deliveries/page.tsx",
];

describe("AgencyActingBanner presence (checkpoint C3)", () => {
  it("the shared component module exports AgencyActingBanner", () => {
    const source = readSource("../src/components/agency-runtime/AgencyActingBanner.tsx");
    expect(source).toMatch(/export function AgencyActingBanner/);
  });

  it("AgencyActingBannerMount imports and renders the real <AgencyActingBanner", () => {
    const source = readSource("../src/components/agency-runtime/AgencyActingBannerMount.tsx");
    expect(source).toMatch(
      /import\s*\{\s*AgencyActingBanner\s*\}\s*from\s*["']\.\/AgencyActingBanner\.js["']/,
    );
    expect(source).toMatch(/<AgencyActingBanner\b/);
  });

  it("the shared agency layout mounts the persistent banner for every agency page", () => {
    const source = readSource("../src/app/agency/layout.tsx");
    // Imports the persistent mount + its acting-context provider from the agency-runtime barrel.
    expect(source).toMatch(
      /import\s*\{[^}]*\bAgencyActingBannerMount\b[^}]*\}\s*from\s*["']@\/components\/agency-runtime["']/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bActingContextProvider\b[^}]*\}\s*from\s*["']@\/components\/agency-runtime["']/,
    );
    // Actually renders the banner mount (inside the provider) so it is persistently visible.
    expect(source).toMatch(/<AgencyActingBannerMount\b/);
    expect(source).toMatch(/<ActingContextProvider\b/);
  });

  for (const page of PAGES_COVERED_BY_SHARED_BANNER) {
    it(`${page} exists and is an agency page rendered inside the shared banner shell`, () => {
      const source = readSource(page);
      // A default-exported page component => rendered inside src/app/agency/layout.tsx, which
      // mounts the persistent AgencyActingBanner asserted above.
      expect(source).toMatch(/export default function \w+/);
      expect(source).toMatch(/代理商工作台/);
    });
  }
});
