/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 企业知识库 index. The batch-1 read API exposes a
 * knowledge package by id (GET /api/knowledge/packages/[id] + /issues) but no list-by-project
 * read endpoint yet, so this index no longer renders business fixtures. The wired readiness +
 * issues screen lives on the detail route (/app/knowledge/[packageId]); a package is opened
 * from there once its reference is known. Presentational scaffolding only — no fixture data.
 */
export default function KnowledgeBasePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>企业知识库</h1>
          <span>知识库的就绪情况与质量问题在具体知识包页面查看。</span>
        </div>
      </header>
      <p className="cp-list-row cp-list-empty" role="status">
        暂无可展示的知识库列表 - 请从具体知识包页面查看其就绪情况与待处理问题。
      </p>
    </>
  );
}
