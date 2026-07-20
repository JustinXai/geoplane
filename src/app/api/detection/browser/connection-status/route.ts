import { NextRequest, NextResponse } from "next/server";
import { getAuthRuntime } from "@/runtime/auth/runtime-context";
import { toHttpResponse } from "@/runtime/auth/http";
import { apiErr } from "@/runtime/api-contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));
  if (!session) {
    return toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required."));
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const platform = searchParams.get("platform");

  if (!projectId || !platform) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const result = await rt.db.query(
    `SELECT * FROM platform_connection 
     WHERE project_id = $1 AND platform = $2`,
    [projectId, platform]
  );

  const conn = result.rows[0];
  return NextResponse.json(conn ?? { status: "NOT_CONNECTED" });
}
