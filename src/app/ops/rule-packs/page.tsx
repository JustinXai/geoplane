/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Business layer:
 *   knowledge -> keyword/question -> opportunity validation -> human review -> article
 *   family/brief -> article compiler -> quality gates" - rule packs govern that chain),
 *   docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md ("A PLATFORM user can manage all
 *   organizations" - rule packs are a platform-owned, cross-tenant governance asset)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: Core Rule Pack / Vertical Pack (规则包) - minimal list view of fixture
 * rule-pack entries (src/app/ops/_fixtures.ts RULE_PACKS). Presentation only.
 */
import { RULE_PACKS } from "../_fixtures";

export default function OpsRulePacksPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>规则包</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。核心规则包与垂直规则包列表。</span>
        </div>
      </header>
      <ul className="cp-list">
        {RULE_PACKS.map((rp) => (
          <li className="cp-list-row" key={rp.referenceCode}>
            <span className="cp-list-title">{rp.name}</span>
            <span className="cp-list-meta">
              {rp.typeLabel} · {rp.versionLabel} · 参考编号 {rp.referenceCode} · 状态：{rp.statusLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
