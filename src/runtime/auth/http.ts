/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL — checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 *   Shared HTTP glue for the account/auth App Router route handlers: maps the frozen
 *   ApiResponseV1 envelope onto a Web `Response` using API_ERROR_HTTP_STATUS, plus the
 *   Set-Cookie builders for login/logout. Kept framework-agnostic (plain Request/Response) so
 *   the routes are directly invokable under vitest without importing next/server.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import {
  API_ERROR_HTTP_STATUS,
  type ApiResponseV1,
} from "../api-contracts/index.js";

/** Maps an ApiResponseV1 to a JSON HTTP Response: 200 on success, the mapped status on error. */
export function toHttpResponse<T>(
  result: ApiResponseV1<T>,
  init: { headers?: Record<string, string>; okStatus?: number } = {},
): Response {
  const status = result.ok ? init.okStatus ?? 200 : API_ERROR_HTTP_STATUS[result.error.code];
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Serialized Set-Cookie for an established session (HttpOnly, Lax, root path). */
export function sessionSetCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Serialized Set-Cookie that clears the session cookie (Max-Age=0). */
export function sessionClearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Parses a JSON request body, returning {} for an empty/invalid body rather than throwing. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.trim() === "") return {};
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
