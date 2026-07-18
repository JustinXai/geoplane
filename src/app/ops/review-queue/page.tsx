/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2): 审核队列 (review queue) — there is no platform-wide
 * review-queue READ endpoint (the review-queue read is per-project, GET /api/projects/[projectId]/
 * review-queue, and GET /api/projects returns no projects for a PLATFORM admin absent a named client
 * org). Per this batch's scope, this surface shows a clean placeholder EMPTY state and fabricates NO
 * data (the earlier fixture list has been removed). It performs no approve/reject action — no form,
 * no submit handler, no write path. When a platform-wide read endpoint lands, wire it here with the
 * five async states.
 */
export default function OpsReviewQueuePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">平台运营</p>
          <h1>审核队列</h1>
          <span>该功能尚无平台级读取接口。此页面为占位状态，不展示任何模拟数据。</span>
        </div>
      </header>
      <p className="cp-placeholder-note" role="status">
        暂无平台级审核队列数据 — 平台级审核读取接口尚未提供，接入后将在此展示真实待审核条目，且不执行任何通过/驳回操作。
      </p>
    </>
  );
}
