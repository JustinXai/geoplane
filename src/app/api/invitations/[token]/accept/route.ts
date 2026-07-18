/**
 * POST /api/invitations/[token]/accept — accepts a PENDING, unexpired, unrevoked invitation whose
 * raw token (from the URL) hashes to the stored token hash, on behalf of the authenticated caller.
 * The invitation's invited email must match the caller's. Unauthenticated -> 401.
 *
 * Checkpoint ACCOUNT_AUTH_RUNTIME_V1 (Agent C2).
 */
import { apiErr } from "../../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../../runtime/auth/runtime-context.js";
import { hashInvitationToken } from "../../../../../contracts/tenancy/invitations.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const rt = getAuthRuntime();
  const { token } = await context.params;

  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const result = await rt.authService.acceptInvitation({
    tokenHash: hashInvitationToken(token),
    user: { id: session.userId, email: session.email, displayName: session.displayName },
    now: new Date(),
  });
  return toHttpResponse(result);
}
