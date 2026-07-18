/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — test double for F1's ApiClient.
 *
 * The client screens are tested as pure data-loading LOGIC (no DOM renderer): a loader is
 * given this fake client, which returns a configured Result per exact request path and
 * records every call, so tests can assert the endpoint chosen and the state the Result maps
 * to. Mirrors how F1 tested selectAsyncState with a fake fetch.
 */
import type {
  ApiClient,
  HttpRequestOptions,
  Result,
} from "../../../src/lib/api-client/http.js";

export interface RecordedCall {
  readonly path: string;
  readonly method: string;
}

export interface FakeApiClient {
  readonly client: ApiClient;
  readonly calls: RecordedCall[];
}

/**
 * Fake ApiClient: returns the configured Result for an exactly-matching path (else a
 * NOT_FOUND Result) and records every call in order.
 */
export function fakeApiClient(
  routes: Readonly<Record<string, Result<unknown>>> = {},
): FakeApiClient {
  const calls: RecordedCall[] = [];
  const client: ApiClient = {
    request<T>(path: string, options?: HttpRequestOptions): Promise<Result<T>> {
      calls.push({ path, method: options?.method ?? "GET" });
      const configured = routes[path];
      const result: Result<unknown> =
        configured ?? {
          ok: false,
          code: "NOT_FOUND",
          message: `no fake route configured for ${path}`,
        };
      return Promise.resolve(result as Result<T>);
    },
  };
  return { client, calls };
}
