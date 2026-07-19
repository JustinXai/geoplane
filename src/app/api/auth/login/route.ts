/** POST /api/auth/login — verifies a password credential before issuing a signed session. */
import { apiErr, apiOk } from "../../../../runtime/api-contracts/index.js";
import { sessionSetCookie, readJsonBody, toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import {
  NON_AUTHENTICATING_PASSWORD_HASH,
  verifyPassword,
} from "../../../../runtime/auth/password-credential.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const body = await readJsonBody(request);
  const email = typeof body.email === "string" ? body.email : null;
  const password = typeof body.password === "string" ? body.password : "";

  const credential = email ? await rt.findLoginCredentialByEmail(email) : null;
  const passwordOk = await verifyPassword(
    password,
    credential?.passwordHash ?? NON_AUTHENTICATING_PASSWORD_HASH,
  );
  if (!credential || !credential.passwordHash || !passwordOk) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Invalid email or password."));
  }

  const result = await rt.authService.login({ user: credential.user, now: new Date() });
  if (!result.ok) {
    return toHttpResponse(result);
  }

  return toHttpResponse(apiOk(result.data.account), {
    headers: {
      "set-cookie": sessionSetCookie(result.data.sessionCookieName, result.data.sessionCookie),
    },
  });
}
