/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md ("An AGENCY
 *   user manages multiple CLIENT organizations, but only ones it has been explicitly
 *   granted access to (explicit assignment, not implicit/wildcard access)"),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation"),
 *   recovered/partial-source/00040000000C9C607C9A7F12-page.tsx (AssignmentForm,
 *   "只有有效分配中的客户可被代理商选择")
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C3 compliance test: the 客户项目 (client projects) fixture must only ever
 * surface CLIENT organizations with an ACTIVE agency assignment. Asserts this at the
 * fixture-shape level (src/app/agency/_fixtures.ts), not via a render pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  AGENCY_CLIENT_ASSIGNMENTS,
  AGENCY_VISIBLE_CLIENT_PROJECTS,
} from "../src/app/agency/_fixtures.js";

describe("agency client-projects assignment isolation (checkpoint C3)", () => {
  it("fixture assignment list contains at least one REVOKED row (so filtering is exercised)", () => {
    const revoked = AGENCY_CLIENT_ASSIGNMENTS.filter((a) => a.status === "REVOKED");
    expect(revoked.length).toBeGreaterThan(0);
  });

  it("AGENCY_VISIBLE_CLIENT_PROJECTS never includes a client whose assignment is not ACTIVE", () => {
    const activeReferenceCodes = new Set(
      AGENCY_CLIENT_ASSIGNMENTS.filter((a) => a.status === "ACTIVE").map((a) => a.clientReferenceCode),
    );
    expect(AGENCY_VISIBLE_CLIENT_PROJECTS.length).toBeGreaterThan(0);
    for (const client of AGENCY_VISIBLE_CLIENT_PROJECTS) {
      expect(activeReferenceCodes.has(client.clientReferenceCode)).toBe(true);
    }
  });

  it("a client with a REVOKED assignment is not reachable via AGENCY_VISIBLE_CLIENT_PROJECTS", () => {
    const revokedReferenceCodes = AGENCY_CLIENT_ASSIGNMENTS.filter((a) => a.status === "REVOKED").map(
      (a) => a.clientReferenceCode,
    );
    const visibleReferenceCodes = AGENCY_VISIBLE_CLIENT_PROJECTS.map((c) => c.clientReferenceCode);
    for (const revokedCode of revokedReferenceCodes) {
      expect(visibleReferenceCodes).not.toContain(revokedCode);
    }
  });
});
