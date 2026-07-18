/**
 * POST /api/auth/login — establishes a session for an already-authenticated user and returns
 * their AccountViewV1 with a Set-Cookie. Credential verification is out of scope (see
 * src/lib/session-cookie.ts): the body identifies the user by email; the user row must exist.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { sessionSetCookie, readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const body = await readJsonBody(request);
  const email = typeof body.email === "string" ? body.email : null;
  if (!email) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "A user email is required to log in."));
  }

  const user = await rt.findUserByEmail(email);
  if (!user) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "No user exists for that email."));
  }

  const result = await rt.authService.login({ user, now: new Date() });
  if (!result.ok) {
    return toHttpResponse(result);
  }

  return toHttpResponse(apiOk(result.data.account), {
    headers: {
      "set-cookie": sessionSetCookie(result.data.sessionCookieName, result.data.sessionCookie),
    },
  });
}
