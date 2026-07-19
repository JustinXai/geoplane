export interface AgencyUnavailableProps {
  readonly title: string;
  readonly description: string;
}

export function AgencyUnavailable({ title, description }: AgencyUnavailableProps) {
  return (
    <>
      <header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>{title}</h1><span>{description}</span></div></header>
      <section className="cp-section" aria-labelledby="unavailable-title">
        <h2 id="unavailable-title">当前暂不可用</h2>
        <p className="cp-placeholder-note" role="status">当前后端尚未提供该页面所需的安全读取能力，因此不展示模拟数据，也不提供无法落库的操作。能力接入后，此处将只显示当前代理商已获授权客户的数据。</p>
      </section>
    </>
  );
}
