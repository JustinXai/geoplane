/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation" -
 *   "An AGENCY user may only act on CLIENT organizations it has an explicit, active
 *   assignment to"), docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (AGENCY/CLIENT
 *   organization model), and the frozen checkpoint C3 spec requirement that every
 *   agency-acting-for-client screen carry a visible, unmissable banner ("代理商代客户
 *   操作有醒目 Banner").
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Shared, unmissable banner rendered on every AGENCY workspace page built in
 * checkpoint C3, making it visually obvious the agency is acting on behalf of a
 * specific CLIENT organization - never silently. Every C3 page uses this one
 * component instead of a copy-pasted per-page banner, so wording/behavior stays
 * consistent and any future real acting-context check only needs to change here.
 *
 * TODO(rebuild/tenancy-auth): once the future AuthorizationContext exists, the
 * acting-for-client identity rendered here must come from the signed-in session's
 * resolved context, gated on a real ACTIVE AgencyClientAssignment row (see
 * SYSTEM_INVARIANTS_V1 "Tenant isolation"), not from caller-supplied props backed by
 * fixture data. This checkpoint is presentation-only - see
 * src/app/agency/_fixtures.ts AGENCY_ACTING_CONTEXT for the fixture source every C3
 * page currently passes in here.
 */
export interface AgencyActingBannerProps {
  readonly actingForClientOrgName: string;
  readonly actingForClientReferenceCode: string;
}

export function AgencyActingBanner({
  actingForClientOrgName,
  actingForClientReferenceCode,
}: AgencyActingBannerProps) {
  return (
    <div className="cp-acting-banner" role="alert">
      <strong>代理商代客户操作</strong>
      <span>
        当前正在代表客户「{actingForClientOrgName}」（{actingForClientReferenceCode}）执行操作，本页所有内容与后续操作均以该客户身份记录，并非代理商自身操作。
      </span>
    </div>
  );
}
