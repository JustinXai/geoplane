"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — persistent mount for the acting-for-client banner.
 *
 * Rendered ONCE in the shared agency shell (src/app/agency/layout.tsx) so the banner is shown on
 * EVERY agency page whenever the agency is acting for a client (frozen C3 invariant), and hidden
 * when it is not. Reads the shared acting-context store and renders the real AgencyActingBanner
 * via the no-impersonation view-model (toActingBannerView).
 */
import { AgencyActingBanner } from "./AgencyActingBanner.js";
import { toActingBannerView } from "./acting-context.js";
import { useActingContext } from "./acting-context-store.js";

export function AgencyActingBannerMount() {
  const { context } = useActingContext();
  if (context === null) return null;
  return <AgencyActingBanner banner={toActingBannerView(context)} />;
}
