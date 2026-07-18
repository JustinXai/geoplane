/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — persistent, unmissable "acting for <client>"
 * banner, driven by the REAL acting-context view-model (toActingBannerView over the POST
 * /api/agency/context response) rather than fixtures.
 *
 * Rendered whenever the agency has an active acting-for-client context. It states BOTH identities
 * explicitly — the agency as the real actor and the client as the subject — so the agency is
 * never presented as the client (no impersonation). Reuses the existing `cp-acting-banner`
 * class + role="alert"; no restyling.
 */
import type { ActingBannerView } from "./acting-context.js";

export interface AgencyActingBannerProps {
  readonly banner: ActingBannerView;
}

export function AgencyActingBanner({ banner }: AgencyActingBannerProps) {
  return (
    <div className="cp-acting-banner" role="alert" data-actor-is-agency="true">
      <strong>代理商代客户操作</strong>
      <span>
        代理商「{banner.actorOrganizationName}」当前正在代表客户「
        {banner.actingForClientOrganizationName}」查看内容。所有内容与操作均以代理商身份记录，
        并非客户本人操作。
      </span>
    </div>
  );
}
