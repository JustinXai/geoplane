/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — the pure write-action state selector reduces
 * (submitting flag + last Result) to exactly one of idle / submitting / success / forbidden / error,
 * mapping a 500 and a 422 to error (with their distinct codes) and 401 / 403 to forbidden. This is
 * the same pipeline the submit controls render, tested without a DOM renderer.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "../../../src/lib/api-client/http.js";
import { selectWriteState } from "../../../src/components/client-runtime/write-actions.js";

describe("selectWriteState", () => {
  it("idle: nothing submitted yet (no result, not submitting)", () => {
    expect(selectWriteState({ submitting: false, result: undefined }).status).toBe("idle");
  });

  it("submitting takes precedence even if a previous result is present", () => {
    expect(selectWriteState({ submitting: true, result: ok({}) }).status).toBe("submitting");
    expect(selectWriteState({ submitting: true, result: undefined }).status).toBe("submitting");
  });

  it("success: a resolved ok result", () => {
    expect(selectWriteState({ submitting: false, result: ok({ id: "x" }) }).status).toBe("success");
  });

  it("forbidden: 401 UNAUTHENTICATED and 403 FORBIDDEN carry code + message", () => {
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN"] as const) {
      const state = selectWriteState({ submitting: false, result: err(code, "no access") });
      expect(state.status).toBe("forbidden");
      if (state.status === "forbidden") {
        expect(state.code).toBe(code);
        expect(state.message).toBe("no access");
      }
    }
  });

  it("error: a 500 (INTERNAL_ERROR) and a 422 (VALIDATION_FAILED) both map to error with their code", () => {
    const server: Result<unknown> = err("INTERNAL_ERROR", "boom");
    const serverState = selectWriteState({ submitting: false, result: server });
    expect(serverState.status).toBe("error");
    if (serverState.status === "error") expect(serverState.code).toBe("INTERNAL_ERROR");

    const validation: Result<unknown> = err("VALIDATION_FAILED", "note required");
    const validationState = selectWriteState({ submitting: false, result: validation });
    expect(validationState.status).toBe("error");
    if (validationState.status === "error") {
      expect(validationState.code).toBe("VALIDATION_FAILED");
      expect(validationState.message).toBe("note required");
    }
  });
});
