/**
 * COMMAND_CSRF_GUARD_V1 wiring (Agent B3).
 *
 * With a `src/` directory present, Next.js only detects the middleware file at `src/middleware.ts`
 * — a `middleware.ts` at the repo root is NOT scanned (Next derives its convention level from the
 * app directory's parent, i.e. `src`). The guard/role-routing implementation lives in the root
 * `middleware.ts` (this lane's file); this module is the thin wiring that places it where Next
 * actually loads it.
 *
 * `runtime = "nodejs"` is required: the role-surface branch decodes the signed session cookie via
 * session-signing.ts, which imports node:crypto / node:fs. Those are unavailable in the Edge
 * runtime (the default), so without the Node runtime the middleware fails to build
 * (UnhandledSchemeError: node:crypto). The CSRF/Origin guard itself is pure and edge-safe; the
 * Node runtime is only needed for the pre-existing session decode.
 *
 * `config` MUST be declared inline here: Next's static matcher analysis does not follow a
 * `config` that is re-exported from another module (it would silently fall back to matching every
 * route). The `middleware` function, by contrast, is followed correctly when re-exported.
 */
export const runtime = "nodejs";
export { middleware } from "../middleware";
export const config = {
  matcher: ["/app/:path*", "/agency/:path*", "/ops/:path*", "/api/:path*"],
};
