/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) tests — a fake ApiClient that records every call and
 * replies from a route table, so the agency loaders can be exercised as pure logic with no DOM,
 * no network, and no jsdom. Mirrors the injection convention F1's api-client already supports
 * (every endpoint takes an optional ApiClient).
 */
import type { ApiClient, HttpRequestOptions, Result } from "../../../src/lib/api-client/index.js";

export interface RecordedCall {
  readonly path: string;
  readonly method: string;
  readonly body?: unknown;
}

/** Route table keyed by "METHOD path", or a responder for dynamic paths. */
export type Routes = Readonly<Record<string, Result<unknown>>> | ((call: RecordedCall) => Result<unknown> | undefined);

export interface FakeApiClient {
  readonly client: ApiClient;
  readonly calls: RecordedCall[];
}

export function makeFakeApiClient(routes: Routes): FakeApiClient {
  const calls: RecordedCall[] = [];

  const client: ApiClient = {
    request<T>(path: string, options?: HttpRequestOptions): Promise<Result<T>> {
      const method = options?.method ?? "GET";
      const call: RecordedCall =
        options?.body !== undefined ? { path, method, body: options.body } : { path, method };
      calls.push(call);

      const response =
        typeof routes === "function" ? routes(call) : routes[`${method} ${path}`];

      if (response === undefined) {
        const miss: Result<T> = {
          ok: false,
          code: "NOT_FOUND",
          message: `fake: no route for ${method} ${path}`,
        };
        return Promise.resolve(miss);
      }
      return Promise.resolve(response as Result<T>);
    },
  };

  return { client, calls };
}
