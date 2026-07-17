/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (evidence note citing the
 *   recovered redirect("/app/projects/example-enterprise/knowledge") pattern)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Root route has no content of its own in this checkpoint - it hands off to
 * /login. Real "already signed in -> which workspace surface" branching
 * belongs to the future AuthorizationContext (rebuild/tenancy-auth).
 */
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/login");
}
