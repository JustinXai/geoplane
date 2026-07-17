# SYSTEM_BLUEPRINT_V1 (frozen)

Status: this document restates the system design as authoritatively
stated by the project owner during `DISASTER_RECOVERY_REBUILD_V1` planning.
It is **not** a recovered artifact — no design doc with this exact content
was found in `E:\GEO_RECOVERY_SAFE`. Treat it as the frozen target that
class-C (`RECONSTRUCTED_FROM_FROZEN_SPEC`) rebuild work must conform to.
Where recovered evidence (see `docs/rebuild/recovered-evidence/`)
corroborates a piece of this design, that is noted inline.

## Identity

GEO Article Production Control Plane — a knowledge-driven article
production and delivery system. Not a generic multi-tenant SaaS platform;
tenancy/organization/auth is a cross-cutting governance and access-control
layer *within* this one control plane, not a separate product.

*Evidence corroboration*: recovered route `redirect("/app/projects/example-enterprise/knowledge")`
and recovered module `@/components/control-plane/pages` (`VisibilityPage`)
both point at a "project → knowledge" application shape consistent with
this description. The literal phrase "GEO Article Production Control
Plane" itself was not found verbatim in recovered evidence.

## Business core (P1–P2)

1. Enterprise knowledge base
2. Keyword and user-question mapping
3. Content and source grounding
4. Client delivery

Post-delivery module (lower priority, not core): performance validation.

## Publication principles (frozen, non-negotiable)

- Platform-neutral: no default to the client's own website, no default to
  any specific large platform.
- No automatic publication, ever.
- WeChatSync-style integrations are external Publisher Bridges for the
  future — not the primary mechanism, not enabled by default.

## Layering

- Governance/access-control layer: tenancy, organization, membership,
  project, invitation, session, audit (see
  `MULTI_TENANT_ACCOUNT_MODEL_V1.md`).
- Business layer: knowledge → keyword/question → opportunity validation →
  human review → article family/brief → article compiler → quality gates
  (see `GEO_BUSINESS_CHAIN_V1.md`).
- Workspace surfaces: client workspace, agency workspace, ops console.
- Distribution layer (lowest priority): distribution, publisher bridge,
  visibility placeholder.

See `docs/governance/SYSTEM_INVARIANTS_V1.md` for the rules that must hold
regardless of which module is being rebuilt.
