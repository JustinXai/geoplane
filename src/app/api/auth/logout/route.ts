/**
 * POST /api/auth/logout — revokes the caller's server-side session (idempotent) and clears the
 * session cookie. Always reports success, even with no valid session.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 */
import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { sessionClearCookie, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import { SESSION_COOKIE_NAME } from "../../../../lib/session-cookie.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const now = new Date();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (session) {
    await rt.authService.logout(session.sessionId, now);
  }
  return toHttpResponse(apiOk({ loggedOut: true }), {
    headers: { "set-cookie": sessionClearCookie(SESSION_COOKIE_NAME) },
  });
}
