"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — client-side acting-for-client store.
 *
 * Holds the current AgencyActingContextV1 (set from a successful POST /api/agency/context) so the
 * persistent banner can render across every agency page via the shared layout, satisfying the
 * frozen C3 invariant "代理商代客户操作有醒目 Banner / 持续显示". The store lives in the agency
 * shell (src/app/agency/layout.tsx), so the acting context survives client-side navigation between
 * agency pages once a client is selected.
 *
 * No-impersonation: the stored value is the raw AgencyActingContextV1, which keeps the agency
 * (actor) and client (subject) identities distinct and pins surface to "agency"; the banner
 * view-model derives from it via toActingBannerView, never conflating the two.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AgencyActingContextV1 } from "./agency-api.js";

export interface ActingContextValue {
  /** The client the agency is currently acting for, or null when not acting for anyone. */
  readonly context: AgencyActingContextV1 | null;
  readonly setActingContext: (context: AgencyActingContextV1 | null) => void;
}

const ActingContext = createContext<ActingContextValue | null>(null);

export function ActingContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<AgencyActingContextV1 | null>(null);
  const value = useMemo<ActingContextValue>(
    () => ({ context, setActingContext: setContext }),
    [context],
  );
  return <ActingContext.Provider value={value}>{children}</ActingContext.Provider>;
}

export function useActingContext(): ActingContextValue {
  const value = useContext(ActingContext);
  if (value === null) {
    throw new Error("useActingContext must be used within an ActingContextProvider.");
  }
  return value;
}
