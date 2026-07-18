# NEXTJS_PRODUCTION_BUILD

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 七.
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).

## What changed

`package.json` scripts, per this phase's exact mandate:

| Script | Before | Now |
|---|---|---|
| `dev` | (did not exist) | `next dev` |
| `build:web` | (did not exist) | `next build` — the real production build |
| `start` | (did not exist) | `next start` |
| `build:contracts` | was named `build`, ran `tsc -p tsconfig.build.json` over all of `src` | renamed, scope narrowed (see below) |
| `typecheck` | unchanged | `tsc --noEmit` |
| `test` | unchanged | `vitest run` |

`tsconfig.build.json` previously included all of `src/` — meaning
"build" was silently compiling the Next.js `src/app` pages through plain
`tsc`, which is not what actually ships a Next.js production build (no
route manifest, no static generation, no bundling). Per this phase's
explicit instruction ("不得继续把 tsc build 称为 Frontend Production
Build"), `tsconfig.build.json` now scopes to `src/contracts` and
`src/composition` only — the TypeScript library portion — and `next
build` (`build:web`) is the actual frontend production build.

## Verification

`npm run build:web` (`next build`) — **PASS**, first attempt, no code
changes required. Turbopack, compiled in 1.8s, typechecked in 2.5s,
30 routes generated (29 real pages + Next's own `/_not-found`) across all
three workspace surfaces plus `/login`:

- **Client routes (7)**: `/app`, `/app/content`, `/app/delivery`,
  `/app/keywords`, `/app/knowledge`, `/app/knowledge/[packageId]`
  (dynamic, server-rendered on demand — the only non-static route),
  `/app/performance`.
- **Agency routes (8)**: `/agency`, `/agency/batch-tasks`,
  `/agency/branding`, `/agency/deliveries`, `/agency/projects`,
  `/agency/review-queue`, `/agency/team`, `/agency/templates`.
- **Ops routes (12)**: `/ops`, `/ops/audit`, `/ops/client-assignments`,
  `/ops/evidence-audit`, `/ops/executions`, `/ops/invitations`,
  `/ops/models-usage`, `/ops/organizations`, `/ops/publisher-connectors`,
  `/ops/review-queue`, `/ops/rule-packs`, `/ops/system-health`.
- **Other (2)**: `/`, `/login`.

`npm run typecheck`, `npm test` (212/212), and `npm run build:contracts`
all re-verified passing after Next's automatic `tsconfig.json`
reconfiguration (standard behavior on first real `next build` — added
`allowJs`/`incremental`/`resolveJsonModule`, switched `jsx` from
`"preserve"` to `"react-jsx"` to match Next's automatic JSX runtime,
appended `.next/types/**/*.ts` to `include`). `next-env.d.ts` was also
regenerated to Next's standard form — this file is Next-managed
("this file should not be edited") and had only ever been hand-crafted
during C1 because no real `next build`/`next dev` had been run yet.

`.next/` and `dist/` both confirmed still gitignored — no build output
was staged.

## Real middleware added (required for section 8 to be meaningful)

Build-time route generation succeeding only proves the pages compile and
render statically — it does not prove an unauthenticated or wrong-role
request is rejected at runtime. Checked the actual codebase and confirmed
**no route was wired to any authentication/authorization enforcement at
all** — every C1-C6 checkpoint was explicitly presentation-only, by
design, at the time. Without fixing that, section 8's HTTP smoke test
requirements ("未登录访问受保护页面被拒绝" / "Client 访问 Agency 被拒绝" /
"Agency 访问 Ops 被拒绝") would have nothing real to test against.

Added, this section (not new "business features" — this is the acceptance
infrastructure sections 7-8 themselves require):

- `src/lib/session-cookie.ts` — a plain base64url-JSON session cookie
  shape, **explicitly documented as not cryptographically signed and not
  production-grade auth** (see that file's header) — sufficient to prove
  the routing/isolation *logic* is real and HTTP-enforced, not a claim
  that a real login system now exists.
- `middleware.ts` — real Next.js middleware, matched on `/app/*`,
  `/agency/*`, `/ops/*`. No session → 302 redirect to `/login`. Session
  present but wrong role tier for the requested surface → real HTTP 403,
  not a client-side redirect a script could bypass — the concrete,
  executable form of SYSTEM_INVARIANTS_V1.md's "front-end hiding a
  control is not a substitute for backend permission verification".

Confirmed compiled into the production build: `next build`'s route table
now includes `ƒ Proxy (Middleware)`. `tests/session-cookie.test.ts`
covers encode/decode round-tripping and the role→surface mapping
directly; the middleware's actual HTTP behavior (redirect/403/200) is
verified for real in section 8 against a running `next start` server, not
just unit-tested in isolation.
