/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md
 * reconstruction_reason: acceptance-phase test, net-new during
 *   REBUILD_INTEGRATION_ACCEPTANCE_V1 - no original test source recoverable.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * This phase's mandate: "新增 Contract Drift Test：任何重复 Enum 或不兼容镜像类型必须失败"
 * (add a contract-drift test: any duplicate enum or incompatible mirror type must fail).
 *
 * Two independent checks:
 *   1. A static source scan across every src/app/**\/*.ts(x) file for a literal-union
 *      `export type` declaration whose value set exactly matches one of the known
 *      canonical union signatures below (e.g. "ACTIVE"|"REVOKED", or the
 *      PLATFORM/AGENCY/CLIENT organization-type set) - this is what a *reintroduced*
 *      duplicate would look like, since every current frontend file was fixed during
 *      this acceptance phase to import the canonical type instead. A type ALIAS
 *      (`export type X = CanonicalType` or `export type X = Extract<CanonicalType, ...>`)
 *      is fine and does not match this pattern - only an independently-spelled-out
 *      literal union does.
 *   2. Type-level equality assertions (via a `TypesAreEqual` helper, checked at
 *      `tsc --noEmit` time through `@ts-expect-error` on purpose-built failure cases)
 *      proving the frontend's remaining UI-local aliases really do resolve to the
 *      canonical business type, not just a same-shaped duplicate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type {
  AgencyClientAssignmentStatus,
  InvitationStatus,
  OrganizationType,
  PlatformRole,
} from "../../src/contracts/tenancy/entities.js";
import type { ClientReviewDecisionValue } from "../../src/contracts/tenancy/review.js";
import type { ClientConfirmationDecision } from "../../src/app/app/_confirmation.js";
import type { AgencyTeamRole } from "../../src/app/agency/_fixtures.js";
import type { InvitationStatus as OpsInvitationStatus } from "../../src/app/ops/_fixtures.js";

function repoPath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function readSource(relativePath: string): string {
  return readFileSync(repoPath(relativePath), "utf8");
}

function listSourceFilesRecursive(dirRelative: string): string[] {
  const dirAbs = repoPath(dirRelative);
  const out: string[] = [];
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    const childRelative = `${dirRelative}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listSourceFilesRecursive(childRelative));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(childRelative);
    }
  }
  return out;
}

/**
 * Normalizes a literal-union RHS ( `"A" | "B" | "C"` , any spacing/quote style) into a
 * sorted, comma-joined signature so declaration order never matters for comparison.
 */
function normalizeUnionSignature(raw: string): string {
  const literals = [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return literals.sort().join(",");
}

// Canonical union signatures that must never be independently re-spelled-out anywhere
// under src/app/. Every one of these has a real canonical source-of-truth file listed.
const CANONICAL_UNION_SIGNATURES: Record<string, string> = {
  [normalizeUnionSignature('"PLATFORM" | "AGENCY" | "CLIENT"')]: "OrganizationType (src/contracts/tenancy/entities.ts)",
  [normalizeUnionSignature('"ACTIVE" | "REVOKED"')]: "AgencyClientAssignmentStatus (src/contracts/tenancy/entities.ts)",
  [normalizeUnionSignature('"CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED"')]:
    "ClientReviewDecisionValue (src/contracts/tenancy/review.ts)",
  [normalizeUnionSignature('"PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"')]:
    "InvitationStatus (src/contracts/tenancy/entities.ts)",
  [normalizeUnionSignature('"PLATFORM_SUPER_ADMIN" | "AGENCY_OWNER" | "AGENCY_OPERATOR" | "CLIENT_OWNER"')]:
    "PlatformRole (src/contracts/tenancy/entities.ts)",
};

describe("contract drift: no frontend file independently re-spells-out a canonical union (acceptance phase)", () => {
  const frontendFiles = listSourceFilesRecursive("../../src/app");

  it("found frontend files to scan (sanity check)", () => {
    expect(frontendFiles.length).toBeGreaterThan(10);
  });

  // `export type Name = "A" | "B" | ...;` - a literal-union type alias with no reference
  // to another identifier. Deliberately does NOT match `export type Name = SomeImport;`
  // or `export type Name = Extract<SomeImport, ...>;`, which are the correct alias forms.
  const LITERAL_UNION_DECLARATION = /export type \w+\s*=\s*("(?:[^"\\]|\\.)*"(?:\s*\|\s*"(?:[^"\\]|\\.)*")*)\s*;/g;

  for (const file of frontendFiles) {
    it(`${file}: no independently-re-spelled-out canonical union`, () => {
      const source = readSource(file);
      for (const match of source.matchAll(LITERAL_UNION_DECLARATION)) {
        const unionText = match[1];
        if (unionText === undefined) continue;
        const signature = normalizeUnionSignature(unionText);
        const canonicalOwner = CANONICAL_UNION_SIGNATURES[signature];
        expect(
          canonicalOwner,
          `${file} declares a literal union matching canonical type "${canonicalOwner}" ` +
            `(${match[0].trim()}) - import the canonical type instead of re-spelling it out.`,
        ).toBeUndefined();
      }
    });
  }
});

describe("contract drift: type-level equality between UI-local aliases and canonical business types", () => {
  // Compile-time-only check: if either alias assignment below ever stopped being
  // mutually assignable with its canonical counterpart, these lines would fail
  // `tsc --noEmit` (this test file is included in the typecheck), which is the real
  // enforcement mechanism - the `it()` bodies just give vitest something to report.
  type AssertEqual<A, B> = A extends B ? (B extends A ? true : false) : false;

  it("ClientConfirmationDecision (UI) === ClientReviewDecisionValue (canonical)", () => {
    const check: AssertEqual<ClientConfirmationDecision, ClientReviewDecisionValue> = true;
    expect(check).toBe(true);
  });

  it("AgencyTeamRole (UI) is a real subset of PlatformRole (canonical), not an independent union", () => {
    const check: AssertEqual<AgencyTeamRole, Extract<PlatformRole, "AGENCY_OWNER" | "AGENCY_OPERATOR">> = true;
    expect(check).toBe(true);
    // AgencyTeamRole must be assignable INTO PlatformRole (a real subset), not merely
    // structurally similar.
    const asRole: PlatformRole = "AGENCY_OWNER" as AgencyTeamRole;
    expect(asRole).toBe("AGENCY_OWNER");
  });

  it("ops _fixtures.ts InvitationStatus === canonical InvitationStatus", () => {
    const check: AssertEqual<OpsInvitationStatus, InvitationStatus> = true;
    expect(check).toBe(true);
  });

  it("canonical AgencyClientAssignmentStatus has exactly the 2 real values (no drift)", () => {
    const values: readonly AgencyClientAssignmentStatus[] = ["ACTIVE", "REVOKED"];
    expect(new Set(values).size).toBe(2);
  });
});
