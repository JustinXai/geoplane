/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4: 系统健康 (system health) - minimal status/health placeholder view of
 * fixture component-status entries (src/app/ops/_fixtures.ts SYSTEM_HEALTH_COMPONENTS).
 * Presentation only, no real monitoring/health-check integration.
 */
import { SYSTEM_HEALTH_COMPONENTS } from "../_fixtures";

export default function OpsSystemHealthPage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>系统健康</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接，非真实监控接入。</span>
        </div>
      </header>
      <ul className="cp-list">
        {SYSTEM_HEALTH_COMPONENTS.map((h) => (
          <li className="cp-list-row" key={h.referenceCode}>
            <span className="cp-list-title">{h.componentLabel}</span>
            <span className="cp-list-meta">
              状态：{h.statusLabel} · 最近检查 {h.checkedLabel}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
