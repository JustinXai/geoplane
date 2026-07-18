import { describe, expect, it } from "vitest";
import {
  isEmptyList,
  selectAsyncState,
} from "../../../src/components/runtime/async-state.js";
import type { Result } from "../../../src/lib/api-client/http.js";

describe("selectAsyncState — the five UI states", () => {
  it("undefined result -> loading", () => {
    expect(selectAsyncState({ result: undefined }).status).toBe("loading");
  });

  it("ok result with non-empty data -> success (carries the data)", () => {
    const result: Result<{ items: number[] }> = { ok: true, data: { items: [1, 2] } };
    const state = selectAsyncState({ result, isEmpty: isEmptyList });
    expect(state.status).toBe("success");
    if (state.status === "success") {
      expect(state.data.items).toEqual([1, 2]);
    }
  });

  it("ok result flagged empty by predicate -> empty", () => {
    const result: Result<{ items: number[] }> = { ok: true, data: { items: [] } };
    expect(selectAsyncState({ result, isEmpty: isEmptyList }).status).toBe("empty");
  });

  it("ok result with no isEmpty predicate -> success (never empty)", () => {
    const result: Result<{ items: number[] }> = { ok: true, data: { items: [] } };
    expect(selectAsyncState({ result }).status).toBe("success");
  });

  it("UNAUTHENTICATED -> forbidden", () => {
    const result: Result<unknown> = { ok: false, code: "UNAUTHENTICATED", message: "log in" };
    const state = selectAsyncState({ result });
    expect(state.status).toBe("forbidden");
    if (state.status === "forbidden") {
      expect(state.code).toBe("UNAUTHENTICATED");
      expect(state.message).toBe("log in");
    }
  });

  it("FORBIDDEN -> forbidden", () => {
    const result: Result<unknown> = { ok: false, code: "FORBIDDEN", message: "no access" };
    expect(selectAsyncState({ result }).status).toBe("forbidden");
  });

  it("NOT_FOUND / VALIDATION_FAILED / CONFLICT / INTERNAL_ERROR -> error", () => {
    for (const code of ["NOT_FOUND", "VALIDATION_FAILED", "CONFLICT", "INTERNAL_ERROR"] as const) {
      const result: Result<unknown> = { ok: false, code, message: code };
      const state = selectAsyncState({ result });
      expect(state.status).toBe("error");
      if (state.status === "error") {
        expect(state.code).toBe(code);
      }
    }
  });
});

describe("isEmptyList", () => {
  it("true for an empty items array", () => {
    expect(isEmptyList({ items: [] })).toBe(true);
  });
  it("false for a non-empty items array", () => {
    expect(isEmptyList({ items: ["x"] })).toBe(false);
  });
});
