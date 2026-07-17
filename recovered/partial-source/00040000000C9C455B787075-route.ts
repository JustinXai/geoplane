import { NextResponse } from "next/server";
import { requireSurfaceAuthorization, tenancyRepository } from "@/auth/server-authorization";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSurfaceAuthorization("ops");
  const { id } = await params;
  await tenancyRepository.revokeInvitation({ invitationId: id, actor, now: new Date() });
  return NextResponse.json({ ok: true });
}
