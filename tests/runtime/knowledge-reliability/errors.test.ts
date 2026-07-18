/**
 * Tests for KNOWLEDGE_INGESTION_RELIABILITY_V1 (Agent F) — the error taxonomy itself.
 *
 * Guards that the closed taxonomy covers every mode the checkpoint requires and that the
 * Result constructors behave, so callers can branch on `code` exhaustively.
 */
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_ERROR_CODES,
  err,
  ok,
  type KnowledgeErrorCode,
} from "../../../src/runtime/knowledge/parsers/index.js";

const REQUIRED_CODES: readonly KnowledgeErrorCode[] = [
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "PARSE_FAILED",
  "EMPTY_CONTENT",
  "ENCRYPTED_DOCUMENT",
  "URL_TIMEOUT",
  "URL_NOT_HTML",
  "DOWNLOAD_FAILED",
];

describe("knowledge error taxonomy", () => {
  it("covers every required failure mode", () => {
    for (const code of REQUIRED_CODES) {
      expect(KNOWLEDGE_ERROR_CODES).toContain(code);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(KNOWLEDGE_ERROR_CODES).size).toBe(KNOWLEDGE_ERROR_CODES.length);
  });

  it("ok() wraps a value; err() carries code + message + cause", () => {
    const good = ok(42);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toBe(42);

    const cause = new Error("boom");
    const bad = err("PARSE_FAILED", "nope", cause);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe("PARSE_FAILED");
      expect(bad.error.message).toBe("nope");
      expect(bad.error.cause).toBe(cause);
    }
  });
});
