import type { ReactNode } from "react";

export function UnavailableState({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="cp-callout" role="status" aria-label={title}>
      <strong>{title}</strong>
      <p>{children}</p>
    </section>
  );
}
