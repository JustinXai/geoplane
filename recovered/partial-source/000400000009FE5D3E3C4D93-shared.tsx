export function FoundationPage({ title, items }: { title: string; items: string[] }) {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">V0-F01 Foundation</p>
          <h1>{title}</h1>
        </div>
        <span className="status-pill">Schema / Contract</span>
      </header>
      <section className="band">
        <div className="panel narrow">
          <h2>Boundary</h2>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
