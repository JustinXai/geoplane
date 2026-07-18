/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation",
 *   "Publication"), src/lib/workspace-nav.ts (assertSurfaceIsolatedLinks +
 *   CLIENT/AGENCY/OPS_WORKSPACE_NAV_LINKS), src/app/app/_fixtures.ts + _confirmation.ts
 *   (checkpoint C2/C5), src/app/agency/_fixtures.ts (checkpoint C3), src/app/ops/_fixtures.ts
 *   (checkpoint C4), tests/client-workspace-copy.test.ts and tests/ops-workspace-copy.test.ts
 *   (established the UUID/provider-name/pipeline-terminology pattern-check convention this
 *   file extends), tests/agency-acting-banner.test.ts (established the node:fs source-level
 *   static-scan convention this file extends to a form/network-call scan)
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C6 "页面边界测试" (page boundary tests) - the closing audit checkpoint for this
 * lane's current scope. This file is deliberately NOT a rehash of what C1-C5's own
 * per-checkpoint tests already covered: those tests check one surface/fixture file each,
 * in isolation, at the time each checkpoint landed. This file re-verifies, against the
 * CURRENT state of the whole built surface (all of src/app/app, src/app/agency,
 * src/app/ops, and src/lib/workspace-nav.ts together), that the frozen-spec boundary rules
 * still hold now that C5 has landed on top of C1-C4. Every check below reads the real
 * exported arrays/source files directly - nothing here is "trust the guard/comment", each
 * rule is re-derived independently from the current code.
 *
 * Audit result: every rule below was checked against the current tree and found to
 * already hold. No violation was found, so no production code changes were required for
 * this checkpoint - see docs/rebuild/DAILY_DELIVERY_BOARD.md's C6 row for the explicit
 * "no violation found" statement.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AGENCY_WORKSPACE_NAV_LINKS,
  CLIENT_WORKSPACE_NAV_LINKS,
  OPS_WORKSPACE_NAV_LINKS,
  assertSurfaceIsolatedLinks,
  type WorkspaceNavLink,
} from "../src/lib/workspace-nav.js";
import { ACTIVE_PROJECT, DELIVERY_ITEMS, collectClientVisibleStrings } from "../src/app/app/_fixtures.js";
import { CLIENT_CONFIRMATION_LABELS } from "../src/app/app/_confirmation.js";
import { AGENCY_DELIVERY_PACKAGES } from "../src/app/agency/_fixtures.js";
import { PUBLISHER_CONNECTORS } from "../src/app/ops/_fixtures.js";

function repoPath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function readSource(relativePath: string): string {
  return readFileSync(repoPath(relativePath), "utf8");
}

/** Strips `/** ... *\/` block comments (including JSDoc headers) and `// ...` line
 * comments from a TS/TSX source string. Comment prose routinely contains apostrophes
 * (e.g. "this lane's spec") that would otherwise be misread as opening a single-quoted
 * string literal by a naive quote-matching regex, so this must run BEFORE any
 * string-literal extraction. Best-effort (not a real tokenizer) - sufficient for this
 * repo's actual comment style (no `//` or block-comment markers embedded inside string
 * literals in this codebase), matching this checkpoint's stated "plain string-pattern
 * check, not a full render pipeline" scope. */
function stripComments(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlockComments.replace(/\/\/.*$/gm, " ");
}

/** Lists every `page.tsx` file that exists directly under one level of subdirectories of
 * `dir` (i.e. `<dir>/<segment>/page.tsx`), plus `<dir>/page.tsx` itself if present.
 * Enumerated dynamically via node:fs rather than hardcoded, so this stays accurate as
 * pages are added/removed - matching the audit instruction to scan "every page file",
 * not a fixed list captured at write-time. */
function listPageFiles(surfaceDirRelative: string): string[] {
  const surfaceDirAbs = repoPath(surfaceDirRelative);
  const files: string[] = [];

  const rootPage = `${surfaceDirRelative}/page.tsx`;
  try {
    readFileSync(repoPath(rootPage), "utf8");
    files.push(rootPage);
  } catch {
    // no root page.tsx for this surface - fine, not every surface has one at this depth
  }

  for (const entry of readdirSync(surfaceDirAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = `${surfaceDirRelative}/${entry.name}/page.tsx`;
    try {
      readFileSync(repoPath(candidate), "utf8");
      files.push(candidate);
    } catch {
      // this subdirectory has no page.tsx at this depth (e.g. app/knowledge/[packageId]) -
      // handled by the recursive walk below for the client-copy scan; agency/ops are flat.
    }
  }

  return files;
}

/** Recursively lists every `.tsx`/`.ts` file under `dirRelative`, for the deeper client
 * surface which has a nested dynamic route (src/app/app/knowledge/[packageId]/page.tsx). */
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

// ---------------------------------------------------------------------------
// Shared pattern library (redeclared locally per the convention already established by
// tests/client-workspace-copy.test.ts and tests/ops-workspace-copy.test.ts).
// ---------------------------------------------------------------------------

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Broader than UUID_PATTERN: catches any long hex-looking token (e.g. a bare git-style
// SHA fragment) that isn't shaped like the dashed UUID above. Requires at least one a-f
// letter so plain numeric reference-code suffixes ("0007", "0142", ...) never false-positive
// (a run of pure digits, however long, is a phone number / date / count - not a hash).
function containsHashLikeToken(value: string): boolean {
  const tokens = value.match(/\b[0-9a-f]{8,40}\b/gi) ?? [];
  return tokens.some((token) => /[a-f]/i.test(token));
}

const PROVIDER_VENDOR_NAMES = [
  "openai",
  "deepseek",
  "anthropic",
  "claude",
  "gpt-4",
  "gpt4",
  "wechatsync",
  "chatgpt",
];

const INTERNAL_PIPELINE_TERMS = ["candidate", "候选", "brief", "简报", "artifact", "产物", "compiler", "编译"];

function assertNoLeakage(value: string, context: string) {
  expect(value, `${context}: must not contain a raw UUID`).not.toMatch(UUID_PATTERN);
  expect(containsHashLikeToken(value), `${context}: must not contain a hash-like token`).toBe(false);
  const lowered = value.toLowerCase();
  for (const name of PROVIDER_VENDOR_NAMES) {
    expect(lowered.includes(name), `${context}: must not contain provider/vendor name "${name}"`).toBe(false);
  }
  for (const term of INTERNAL_PIPELINE_TERMS) {
    expect(
      lowered.includes(term.toLowerCase()),
      `${context}: must not contain internal pipeline term "${term}"`,
    ).toBe(false);
  }
}

// ===========================================================================
// 1. "客户账户不能看到代理商入口" / "客户账户不能切换客户"
// ===========================================================================

describe("(1) client surface cannot see agency/ops entry points, cannot switch clients", () => {
  it("independent check: every CLIENT_WORKSPACE_NAV_LINKS href is a plain string starting with /app and never /agency or /ops", () => {
    // Deliberately does NOT call isLinkWithinSurface/assertSurfaceIsolatedLinks here -
    // this must hold even if that helper had a bug, so it is re-derived with plain
    // string checks against the real exported array.
    expect(CLIENT_WORKSPACE_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of CLIENT_WORKSPACE_NAV_LINKS) {
      expect(typeof link.href).toBe("string");
      expect(link.href.startsWith("/app")).toBe(true);
      expect(link.href.startsWith("/agency")).toBe(false);
      expect(link.href.startsWith("/ops")).toBe(false);
      // guards against a sneaky "/appagency" style prefix collision
      expect(link.href === "/app" || link.href.startsWith("/app/")).toBe(true);
    }
  });

  it("the guard is not dead code: src/lib/workspace-nav.ts actually wires assertSurfaceIsolatedLinks(\"app\", ...) around the CLIENT export, not just around AGENCY/OPS", () => {
    const source = readSource("../src/lib/workspace-nav.ts");
    expect(source).toMatch(
      /export const CLIENT_WORKSPACE_NAV_LINKS:[^=]*=\s*assertSurfaceIsolatedLinks\(\s*"app"/,
    );
  });

  it("the guard actually throws for a genuine cross-surface link, for all three surfaces (not just the app case already covered by tests/workspace-nav.test.ts)", () => {
    expect(() => assertSurfaceIsolatedLinks("app", [{ label: "bad", href: "/agency/clients" }])).toThrow(
      /Tenant isolation violation/,
    );
    expect(() => assertSurfaceIsolatedLinks("app", [{ label: "bad", href: "/ops/audit" }])).toThrow(
      /Tenant isolation violation/,
    );
    expect(() => assertSurfaceIsolatedLinks("agency", [{ label: "bad", href: "/app" }])).toThrow(
      /Tenant isolation violation/,
    );
    expect(() => assertSurfaceIsolatedLinks("ops", [{ label: "bad", href: "/agency/team" }])).toThrow(
      /Tenant isolation violation/,
    );
  });

  it("no client-facing source file offers a client-switching affordance (no second org, no 切换客户/更换客户 control anywhere under src/app/app)", () => {
    const clientFiles = listSourceFilesRecursive("../src/app/app");
    expect(clientFiles.length).toBeGreaterThan(0);
    const switchKeywords = ["切换客户", "更换客户", "选择客户", "switch client", "org switcher", "organization switcher"];
    for (const file of clientFiles) {
      const source = readSource(file);
      for (const keyword of switchKeywords) {
        expect(source.includes(keyword), `${file}: must not contain client-switching affordance "${keyword}"`).toBe(
          false,
        );
      }
    }
  });

  it("the client workspace's fixture data models exactly one active client organization (ACTIVE_PROJECT), never a selectable list of orgs", () => {
    // A real multi-client switcher would need a list of clientOrgName values to switch
    // between; the CLIENT surface fixture only ever exposes a single one.
    expect(typeof ACTIVE_PROJECT.clientOrgName).toBe("string");
    expect(ACTIVE_PROJECT.clientOrgName.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. "代理商只读预览不能提交"
// ===========================================================================

describe("(2) agency workspace is presentation-only - no page wires a real form submission or network call", () => {
  const agencyPageFiles = listPageFiles("../src/app/agency");

  it("found at least one agency page.tsx to scan (sanity check that enumeration isn't silently empty)", () => {
    expect(agencyPageFiles.length).toBeGreaterThan(0);
  });

  for (const file of agencyPageFiles) {
    it(`${file}: contains no <form>, no onSubmit=, no action= wiring, no fetch/axios call`, () => {
      const source = readSource(file);
      expect(source, `${file}: must not render a <form> element`).not.toMatch(/<form\b/i);
      expect(source, `${file}: must not wire onSubmit=`).not.toMatch(/onSubmit\s*=/);
      // action="..." / action={...} as a real form-submission target (JSX attribute),
      // not the unrelated word "action" appearing in prose/labels.
      expect(source, `${file}: must not wire a real action= attribute`).not.toMatch(/\baction\s*=\s*["'{]/);
      expect(source, `${file}: must not call fetch(`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file}: must not call axios`).not.toMatch(/\baxios\b/i);
      expect(source, `${file}: must not use XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
    });
  }

  it("no file anywhere under src/app/agency (pages or fixtures) contains a real form-submission or network-call pattern", () => {
    const allAgencyFiles = listSourceFilesRecursive("../src/app/agency");
    expect(allAgencyFiles.length).toBeGreaterThan(0);
    for (const file of allAgencyFiles) {
      const source = readSource(file);
      expect(source, `${file}`).not.toMatch(/onSubmit\s*=/);
      expect(source, `${file}`).not.toMatch(/\bfetch\s*\(/);
      expect(source, `${file}`).not.toMatch(/\baxios\b/i);
    }
  });
});

// ===========================================================================
// 3. "客户页面无 UUID / 无 Hash / 无 Provider / 无 Candidate/Brief/Artifact" - extended
//    through the C5 confirmation-flow additions.
// ===========================================================================

describe("(3) client workspace pages (including C5 confirmation additions) leak no UUID/hash/provider-name/pipeline-terminology", () => {
  it("every fixture-derived display string collected by collectClientVisibleStrings() (C2 baseline) is still clean after C5", () => {
    const strings = collectClientVisibleStrings();
    expect(strings.length).toBeGreaterThan(10);
    for (const value of strings) {
      assertNoLeakage(value, "collectClientVisibleStrings()");
    }
  });

  it("every C5 confirmation-state label (CLIENT_CONFIRMATION_LABELS, from ./_confirmation.ts) is clean - this was NOT part of the C2 collector and is checked here for the first time", () => {
    const labels = Object.values(CLIENT_CONFIRMATION_LABELS);
    expect(labels.length).toBe(4);
    for (const label of labels) {
      assertNoLeakage(label, "CLIENT_CONFIRMATION_LABELS");
    }
  });

  it("every .ts/.tsx source file under src/app/app (pages, fixtures, and the C5 _confirmation.ts/_confirmation-control.tsx) is clean at the source-text level - a stronger, direct check than only scanning collected display strings", () => {
    const clientFiles = listSourceFilesRecursive("../src/app/app");
    expect(clientFiles.length).toBeGreaterThan(0);
    // sanity: the C5 files this check specifically must cover are actually present
    expect(clientFiles.some((f) => f.endsWith("_confirmation.ts"))).toBe(true);
    expect(clientFiles.some((f) => f.endsWith("_confirmation-control.tsx"))).toBe(true);

    for (const file of clientFiles) {
      // Source files legitimately contain JS identifiers like `candidate` (a .find()
      // callback param name) and prose comments explaining the very rule this test
      // enforces - neither of those reaches a rendered screen, so this pass strips
      // comments first (stripComments), then extracts only quoted string/template
      // literal contents from what remains, which is what could actually be rendered.
      const codeOnly = stripComments(readSource(file));
      const stringLiterals = codeOnly.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
      for (const literal of stringLiterals) {
        assertNoLeakage(literal, `${file} (string literal ${literal.slice(0, 40)})`);
      }
    }
  });

  it("every .ts/.tsx source file under src/app/app also has no UUID / hash-like token / provider name anywhere in the raw file text (covers static JSX text nodes like <h1>总览</h1> that live outside string literals) - pipeline-terminology is deliberately excluded from this pass since it legitimately false-positives on the `candidate` callback-parameter identifier in src/app/app/knowledge/[packageId]/page.tsx and on this file's own explanatory comments, neither of which reaches a rendered screen; that check is covered precisely by the string-literal-only pass above", () => {
    const clientFiles = listSourceFilesRecursive("../src/app/app");
    for (const file of clientFiles) {
      const source = readSource(file);
      expect(source, `${file}: raw file text must not contain a raw UUID`).not.toMatch(UUID_PATTERN);
      expect(
        containsHashLikeToken(source),
        `${file}: raw file text must not contain a hash-like token`,
      ).toBe(false);
      const lowered = source.toLowerCase();
      for (const name of PROVIDER_VENDOR_NAMES) {
        expect(
          lowered.includes(name),
          `${file}: raw file text must not contain provider/vendor name "${name}"`,
        ).toBe(false);
      }
    }
  });
});

// ===========================================================================
// 4. "客户不能进入 Agency" / "Agency 不能进入 Ops" - full cross-surface isolation matrix
// ===========================================================================

describe("(4) cross-surface nav isolation matrix across every workspace nav array that exists", () => {
  // This audit's brief describes "all four nav link arrays (CLIENT/AGENCY/OPS/whatever
  // exists)". An independent grep of src/**/*.ts(x) for `_WORKSPACE_NAV_LINKS` exports
  // (see below) confirms only three exist in this codebase today - matching the three
  // built workspace surfaces (/app, /agency, /ops). This test iterates whatever the
  // grep finds rather than hardcoding "three", so it stays correct if a fourth surface
  // is ever added.
  const NAV_ARRAYS: Record<string, readonly WorkspaceNavLink[]> = {
    CLIENT: CLIENT_WORKSPACE_NAV_LINKS,
    AGENCY: AGENCY_WORKSPACE_NAV_LINKS,
    OPS: OPS_WORKSPACE_NAV_LINKS,
  };

  it("independent check: exactly the nav arrays exported from src/lib/workspace-nav.ts are exercised here (no silent gap, no phantom fourth array)", () => {
    const source = readSource("../src/lib/workspace-nav.ts");
    const exportedArrayNames = [...source.matchAll(/export const (\w+_WORKSPACE_NAV_LINKS)/g)].map((m) => m[1]);
    expect(exportedArrayNames.sort()).toEqual(
      ["CLIENT_WORKSPACE_NAV_LINKS", "AGENCY_WORKSPACE_NAV_LINKS", "OPS_WORKSPACE_NAV_LINKS"].sort(),
    );
    expect(Object.keys(NAV_ARRAYS).length).toBe(exportedArrayNames.length);
  });

  const SURFACE_OWN_PREFIX: Record<string, string> = { CLIENT: "/app", AGENCY: "/agency", OPS: "/ops" };
  const ALL_PREFIXES = ["/app", "/agency", "/ops"];

  for (const [surfaceName, links] of Object.entries(NAV_ARRAYS)) {
    it(`${surfaceName} nav: every href stays within its own prefix and crosses into no other surface's prefix`, () => {
      expect(links.length).toBeGreaterThan(0);
      const ownPrefix = SURFACE_OWN_PREFIX[surfaceName];
      const otherPrefixes = ALL_PREFIXES.filter((p) => p !== ownPrefix);
      for (const link of links) {
        expect(link.href === ownPrefix || link.href.startsWith(`${ownPrefix}/`)).toBe(true);
        for (const otherPrefix of otherPrefixes) {
          expect(
            link.href.startsWith(otherPrefix),
            `${surfaceName} nav link "${link.href}" must not start with foreign prefix "${otherPrefix}"`,
          ).toBe(false);
        }
      }
    });
  }

  it("full pairwise matrix: no href from any surface's nav array appears reachable from a different surface's allowed-prefix set", () => {
    const allLinksBySurface = Object.entries(NAV_ARRAYS);
    for (const [surfaceName, links] of allLinksBySurface) {
      const ownPrefix = SURFACE_OWN_PREFIX[surfaceName];
      for (const [otherSurfaceName, otherPrefix] of Object.entries(SURFACE_OWN_PREFIX)) {
        if (otherSurfaceName === surfaceName) continue;
        for (const link of links) {
          expect(
            link.href.startsWith(otherPrefix),
            `${surfaceName}'s "${link.href}" must not fall under ${otherSurfaceName}'s prefix "${otherPrefix}" (own prefix is "${ownPrefix}")`,
          ).toBe(false);
        }
      }
    }
  });
});

// ===========================================================================
// 5. "默认渠道数量为 0" / "无自动发布" - re-verified fresh against current fixture values
// ===========================================================================

describe("(5) zero default distribution channels / zero auto-publish, re-verified fresh across all three surfaces after C5", () => {
  it("CLIENT delivery center: every DELIVERY_ITEMS row currently has selectedChannelCount 0, and the sum across all rows is 0", () => {
    expect(DELIVERY_ITEMS.length).toBeGreaterThan(0);
    let total = 0;
    for (const item of DELIVERY_ITEMS) {
      expect(item.selectedChannelCount).toBe(0);
      total += item.selectedChannelCount;
    }
    expect(total).toBe(0);
  });

  it("AGENCY delivery packages: every AGENCY_DELIVERY_PACKAGES row currently has autoPublishedCount 0, and the sum across all rows is 0", () => {
    expect(AGENCY_DELIVERY_PACKAGES.length).toBeGreaterThan(0);
    let total = 0;
    for (const item of AGENCY_DELIVERY_PACKAGES) {
      expect(item.autoPublishedCount).toBe(0);
      total += item.autoPublishedCount;
    }
    expect(total).toBe(0);
  });

  it("OPS publisher connectors: every PUBLISHER_CONNECTORS row is currently disabled with connectedCount 0, and the sums are 0", () => {
    expect(PUBLISHER_CONNECTORS.length).toBeGreaterThan(0);
    let enabledCount = 0;
    let totalConnected = 0;
    for (const conn of PUBLISHER_CONNECTORS) {
      expect(conn.enabled).toBe(false);
      expect(conn.connectedCount).toBe(0);
      if (conn.enabled) enabledCount += 1;
      totalConnected += conn.connectedCount;
    }
    expect(enabledCount).toBe(0);
    expect(totalConnected).toBe(0);
  });

  it("source-level re-scan of all three _fixtures.ts files: no occurrence of selectedChannelCount/autoPublishedCount/connectedCount is bound to a nonzero literal, and no 'enabled: true' literal exists - a defense-in-depth check that does not rely solely on the typed imports above, in case a fixture is edited without updating the typed exports checked here", () => {
    const fixtureFiles = [
      "../src/app/app/_fixtures.ts",
      "../src/app/agency/_fixtures.ts",
      "../src/app/ops/_fixtures.ts",
    ];
    const zeroBoundFieldPattern = /\b(selectedChannelCount|autoPublishedCount|connectedCount)\s*:\s*(\d+)/g;
    let fieldOccurrences = 0;
    for (const file of fixtureFiles) {
      const source = readSource(file);
      expect(source, `${file}: must not contain an 'enabled: true' literal`).not.toMatch(/\benabled\s*:\s*true\b/);
      for (const match of source.matchAll(zeroBoundFieldPattern)) {
        fieldOccurrences += 1;
        expect(match[2], `${file}: ${match[1]} must be literal 0, found "${match[0]}"`).toBe("0");
      }
    }
    // sanity: the scan actually found the fields it's meant to police, across all three files
    expect(fieldOccurrences).toBeGreaterThan(0);
  });
});
