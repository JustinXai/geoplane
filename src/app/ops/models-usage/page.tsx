/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md ("No customer data, no secrets"),
 *   tests/client-workspace-copy.test.ts (established PROVIDER_VENDOR_NAMES compliance
 *   rule that this checkpoint extends to the ops surface)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 模型与用量 (models & usage) - a usage-summary view (src/app/ops/
 * _fixtures.ts MODEL_USAGE_SUMMARIES). IMPORTANT: this page must never display any real
 * AI/model provider or vendor name - model identities are genericized as "模型 A" /
 * "模型 B" style labels with an internal reference code only. See
 * tests/ops-workspace-copy.test.ts for the compliance check against this rule.
 */
import { MODEL_USAGE_NOTICE, MODEL_USAGE_SUMMARIES } from "../_fixtures";

export default function OpsModelsUsagePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>模型与用量</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {MODEL_USAGE_NOTICE}
      </p>
      <ul className="cp-list">
        {MODEL_USAGE_SUMMARIES.map((m) => (
          <li className="cp-list-row" key={m.referenceCode}>
            <span className="cp-list-title">{m.modelLabel}</span>
            <span className="cp-list-meta">
              参考代号 {m.referenceCode} · {m.usageLabel} · 状态：{m.statusLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
