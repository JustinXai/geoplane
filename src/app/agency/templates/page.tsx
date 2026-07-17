/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Workspace surfaces:
 *   client workspace, agency workspace, ops console"; business core items 1-3 which an
 *   industry template accelerates - knowledge base, keyword/question mapping, content
 *   and source grounding)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3: 行业模板 (industry templates) list view for the AGENCY workspace.
 * Fixture data only (src/app/agency/_fixtures.ts INDUSTRY_TEMPLATES) - no real
 * customer data, no database connection.
 */
import { AgencyActingBanner } from "@/components/agency/agency-acting-banner";
import { AGENCY_ACTING_CONTEXT, INDUSTRY_TEMPLATES } from "../_fixtures";

export default function AgencyIndustryTemplatesPage() {
  return (
    <>
      <AgencyActingBanner
        actingForClientOrgName={AGENCY_ACTING_CONTEXT.actingForClientOrgName}
        actingForClientReferenceCode={AGENCY_ACTING_CONTEXT.actingForClientReferenceCode}
      />
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>行业模板</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <ul className="cp-list">
        {INDUSTRY_TEMPLATES.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <span className="cp-list-title">{item.name}</span>
            <span className="cp-list-meta">
              {item.industryLabel} · 参考编号 {item.referenceCode} · 更新于 {item.updatedLabel}
            </span>
            <span className="cp-list-summary">{item.summary}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
