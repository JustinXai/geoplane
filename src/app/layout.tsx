/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/rebuild/RECOVERY_GAP_ANALYSIS.md (P0 gap: "Source root layout -
 *   Not recovered as a directory tree"), docs/architecture/SYSTEM_BLUEPRINT_V1.md (workspace
 *   surfaces layering), recovered/partial-source/*.tsx (Chinese-language UI copy convention)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Root App Router layout - checkpoint C1 "shell" only. No auth, no data
 * fetching, no database connection of any kind. html lang is zh-CN to match
 * the UI-copy language observed throughout recovered/partial-source/*.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "geoplane",
  description: "GEO Article Production Control Plane",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
