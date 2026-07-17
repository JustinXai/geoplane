/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Distribution layer
 *   (lowest priority): distribution, publisher bridge, visibility placeholder" - white-
 *   label branding is grouped with this lowest-priority tier per the frozen spec)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: minimal placeholder for the 品牌白标 (white-label branding) surface.
 * Per the frozen spec this is explicitly a lower-priority feature, so this checkpoint
 * keeps it to a single placeholder screen rather than building real branding controls
 * (logo/theme upload, custom domain, etc.).
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT } from "../_fixtures";

export default function AgencyBrandingPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>品牌白标</h1>
          <span>占位页面 - 品牌白标为冻结规格中明确的低优先级功能，本检查点（C3）暂不展开具体内容。</span>
        </div>
      </header>
    </>
  );
}
