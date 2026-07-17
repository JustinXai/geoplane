/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("No customer data, no
 *   secrets", "Publication"), recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx
 *   (REAL recovered AuditPage - actorUserId.slice(0,8) truncation convention),
 *   docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Publication principles" - WeChatSync-style
 *   integrations not enabled by default), tests/client-workspace-copy.test.ts (established
 *   the UUID / provider-vendor-name compliance-test pattern this file extends to /ops)
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C4 compliance test: every human-visible display string rendered by the
 * PLATFORM/ops workspace surfaces (src/app/ops/_fixtures.ts) must not contain a raw UUID
 * except where explicitly truncated per the recovered
 * 00040000000C9C6422CCAB4F-page.tsx actorUserId.slice(0,8) pattern, must not contain a
 * real AI/model provider or vendor name anywhere on the 模型与用量 page's fixture-derived
 * strings, and the 发布连接器 fixture data must show 0 connectors in an
 * enabled/connected state by default. This is a plain string-pattern check against the
 * fixture-derived display strings, not a full render pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENTS,
  MODEL_USAGE_SUMMARIES,
  PUBLISHER_CONNECTORS,
  actorDisplay,
  collectModelUsageVisibleStrings,
  collectOpsVisibleStrings,
} from "../src/app/ops/_fixtures.js";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Known AI/model provider & vendor names that must never appear on the 模型与用量 page
// (same list convention as tests/client-workspace-copy.test.ts PROVIDER_VENDOR_NAMES).
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

describe("ops workspace copy compliance (checkpoint C4)", () => {
  const strings = collectOpsVisibleStrings();

  it("collected at least one display string per fixture surface", () => {
    expect(strings.length).toBeGreaterThan(10);
  });

  it("(a) contains no raw UUID in any ops-visible display string", () => {
    for (const value of strings) {
      expect(value).not.toMatch(UUID_PATTERN);
    }
  });

  it("(a) the audit fixture's full actorUserId is UUID-shaped internally, but only its 8-char truncated prefix (matching the recovered actorUserId.slice(0,8) pattern) ever reaches a display string", () => {
    expect(AUDIT_EVENTS.length).toBeGreaterThan(0);
    for (const event of AUDIT_EVENTS) {
      // The fixture models a real UUID-shaped id internally...
      expect(event.actorUserId).toMatch(UUID_PATTERN);
      const displayed = actorDisplay(event);
      // ...but the truncated display value is only the first 8 characters, and is not
      // itself a raw UUID, and does not appear anywhere as the full untruncated id in the
      // collected display-string surface.
      expect(displayed).toBe(event.actorUserId.slice(0, 8));
      expect(displayed).not.toMatch(UUID_PATTERN);
      expect(strings).not.toContain(event.actorUserId);
    }
  });

  it("(b) contains no AI/model provider or vendor name in any 模型与用量 fixture-derived display string", () => {
    const modelUsageStrings = collectModelUsageVisibleStrings();
    expect(modelUsageStrings.length).toBeGreaterThan(0);
    for (const value of modelUsageStrings) {
      const lowered = value.toLowerCase();
      for (const name of PROVIDER_VENDOR_NAMES) {
        expect(lowered.includes(name)).toBe(false);
      }
    }
  });

  it("(b) MODEL_USAGE_SUMMARIES model labels are genericized reference-code style, not real vendor names", () => {
    expect(MODEL_USAGE_SUMMARIES.length).toBeGreaterThan(0);
    for (const m of MODEL_USAGE_SUMMARIES) {
      expect(m.modelLabel).toMatch(/^模型 [A-Z]$/);
    }
  });

  it("(c) every 发布连接器 fixture entry defaults to disabled with 0 connections", () => {
    expect(PUBLISHER_CONNECTORS.length).toBeGreaterThan(0);
    for (const conn of PUBLISHER_CONNECTORS) {
      expect(conn.enabled).toBe(false);
      expect(conn.connectedCount).toBe(0);
    }
  });

  it("(c) 0 connectors are enabled/connected across the whole fixture list", () => {
    const enabledCount = PUBLISHER_CONNECTORS.filter((c) => c.enabled).length;
    const totalConnected = PUBLISHER_CONNECTORS.reduce((sum, c) => sum + c.connectedCount, 0);
    expect(enabledCount).toBe(0);
    expect(totalConnected).toBe(0);
  });
});
