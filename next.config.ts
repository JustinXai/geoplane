/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL_EXECUTION_V1 — infra fix owned by Agent A.
 *   The backend source (src/persistence, src/contracts, src/runtime) uses TypeScript
 *   NodeNext-style relative imports with an explicit ".js" extension that actually resolve to
 *   ".ts" files. The webpack builder needs `resolve.extensionAlias` to try ".ts"/".tsx" when a
 *   ".js" specifier is requested, otherwise any API route that pulls the backend graph into a
 *   bundle fails to resolve (`repository-factory.ts` -> `./pg/*.js`, etc.). Paired with the
 *   `build:web` script using `next build --webpack`.
 * original_file_unavailable: true
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
