/**
 * SAFE_REVIEW_REFERENCE_V1 (Agent C2) — unit tests for the opaque, tamper-evident review reference.
 *
 * The reviewReferenceCode must (a) round-trip back to the internal validation id, (b) NEVER carry
 * the raw UUID in clear text on the client surface, and (c) reject any tampered / forged / malformed
 * code (verify returns null, never throws). No database or provider is involved.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeReviewReferenceCode,
  encodeReviewReferenceCode,
} from "../../../src/runtime/geo/review-reference.js";

describe("review-reference — opaque, tamper-evident validation handle", () => {
  it("round-trips a validation id through encode -> decode", () => {
    const validationId = randomUUID();
    const code = encodeReviewReferenceCode(validationId);
    expect(decodeReviewReferenceCode(code)).toBe(validationId);
  });

  it("never carries the raw UUID in clear text (client surface stays opaque)", () => {
    const validationId = randomUUID();
    const code = encodeReviewReferenceCode(validationId);
    expect(code).not.toContain(validationId);
    // Two dot-joined segments: base64url(payload) + HMAC signature.
    expect(code.split(".")).toHaveLength(2);
  });

  it("rejects a tampered signature (verify returns null)", () => {
    const code = encodeReviewReferenceCode(randomUUID());
    const [payload, signature] = code.split(".");
    const flipped = `${signature!.slice(0, -1)}${signature!.endsWith("A") ? "B" : "A"}`;
    expect(decodeReviewReferenceCode(`${payload}.${flipped}`)).toBeNull();
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const code = encodeReviewReferenceCode(randomUUID());
    const [, signature] = code.split(".");
    const forgedPayload = Buffer.from(randomUUID(), "utf8").toString("base64url");
    expect(decodeReviewReferenceCode(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a hand-forged raw code (no valid signature)", () => {
    const forged = Buffer.from(randomUUID(), "utf8").toString("base64url");
    expect(decodeReviewReferenceCode(forged)).toBeNull();
    expect(decodeReviewReferenceCode(`${forged}.not-a-signature`)).toBeNull();
  });

  it("rejects missing / malformed input without throwing", () => {
    expect(decodeReviewReferenceCode(null)).toBeNull();
    expect(decodeReviewReferenceCode(undefined)).toBeNull();
    expect(decodeReviewReferenceCode("")).toBeNull();
    expect(decodeReviewReferenceCode("only-one-segment")).toBeNull();
    expect(decodeReviewReferenceCode("a.b.c")).toBeNull();
    expect(decodeReviewReferenceCode(".signature")).toBeNull();
  });
});
