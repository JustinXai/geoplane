/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — pure, React-free logic for the persistent
 * "acting for <client>" banner.
 *
 * NO-IMPERSONATION invariant: when an agency acts for a client, the agency is still the real
 * actor — the client is only the subject being acted on. The banner view-model therefore keeps
 * the agency identity and the acted-for client identity in SEPARATE fields and flags
 * `actorIsAgency`, so no rendering can present the agency as if it were the client. The source
 * DTO (AgencyActingContextV1) pins `surface` to "agency" and always carries the agency's own
 * org id/name; we surface both here rather than collapsing them.
 */
import type { Result } from "../../lib/api-client/index.js";
import type { AgencyActingContextV1 } from "./agency-api.js";

export interface ActingBannerView {
  /** The real actor — always the agency organization, never the client. */
  readonly actorOrganizationId: string;
  readonly actorOrganizationName: string;
  /** The client the agency is acting FOR (the subject), kept distinct from the actor. */
  readonly actingForClientOrganizationId: string;
  readonly actingForClientOrganizationName: string;
  /** Always true for an agency acting-context: guarantees the actor is presented as the agency. */
  readonly actorIsAgency: true;
  /** Workspace surface the agency remains on ("agency"); it never becomes the client surface. */
  readonly surface: AgencyActingContextV1["surface"];
}

/**
 * Maps a resolved acting-context DTO to the banner view-model. Throws only on a self-referential
 * context (agency id === acted-for client id), which would be an impersonation defect — better to
 * fail loudly than render a banner that conflates actor and subject.
 */
export function toActingBannerView(context: AgencyActingContextV1): ActingBannerView {
  if (context.agencyOrganizationId === context.actingClientOrganizationId) {
    throw new Error(
      "Impersonation invariant violated: agency actor id equals acted-for client id.",
    );
  }
  return {
    actorOrganizationId: context.agencyOrganizationId,
    actorOrganizationName: context.agencyOrganizationName,
    actingForClientOrganizationId: context.actingClientOrganizationId,
    actingForClientOrganizationName: context.actingClientOrganizationName,
    actorIsAgency: true,
    surface: context.surface,
  };
}

/**
 * Banner visibility derived from the acting-context request Result. The banner is present ONLY
 * when a context has been successfully set (Result ok). Before any selection (undefined) or on a
 * FORBIDDEN/failed selection, no banner is shown — an unauthorized selection never yields a
 * banner.
 */
export type ActingBannerState =
  | { readonly visible: false }
  | { readonly visible: true; readonly banner: ActingBannerView };

export function selectActingBanner(
  result: Result<AgencyActingContextV1> | undefined,
): ActingBannerState {
  if (result === undefined || !result.ok) return { visible: false };
  return { visible: true, banner: toActingBannerView(result.data) };
}
