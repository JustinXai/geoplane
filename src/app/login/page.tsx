/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (PLATFORM/AGENCY/
 *   CLIENT organization types - login must eventually branch into 3 surfaces),
 *   recovered/partial-source page.tsx files (cp-page-header convention, Chinese UI copy)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Placeholder login page - static markup only, no form submission, no
 * credential handling, no session/cookie of any kind.
 *
 * TODO(rebuild/tenancy-auth): replace with real sign-in wired to the future
 * AuthorizationContext, which will determine which workspace surface
 * (/app, /agency, /ops) a given identity is routed to post-login.
 */
export default function LoginPage() {
  return (
    <main className="cp-page-header">
      <div>
        <p className="eyebrow">身份验证</p>
        <h1>登录</h1>
        <span>占位登录页 - 真实身份验证由 rebuild/tenancy-auth 提供。</span>
      </div>
    </main>
  );
}
