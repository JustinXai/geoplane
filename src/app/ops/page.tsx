/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Placeholder PLATFORM/ops workspace landing page. Fixture text only - no
 * real customer data, no database connection.
 */
export default function OpsWorkspaceHomePage() {
  return (
    <header className="cp-page-header">
      <div>
        <p className="eyebrow">平台运营</p>
        <h1>组织概览</h1>
        <span>占位数据 - 无真实客户数据、无数据库连接。</span>
      </div>
    </header>
  );
}
