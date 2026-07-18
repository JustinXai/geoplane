/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_reason: acceptance-phase canonical contract root, net-new
 *   during REBUILD_INTEGRATION_ACCEPTANCE_V1. See
 *   docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md for the full audit
 *   of every duplicate business type this eliminated.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * The single canonical import surface for every cross-lane contract in
 * this repository. Per this phase's mandate: "前端必须直接引用 Canonical
 * Contract" (the frontend must import the canonical contract directly) -
 * no lane may redeclare an equivalent enum/interface under a local name.
 * A UI-only presentation state (e.g. a "not yet decided" sentinel with no
 * business-layer equivalent) may still exist locally, but must convert
 * to/from the canonical business type explicitly - see
 * src/app/app/_confirmation.ts for the pattern.
 *
 * Four namespaces, matching this phase's spec:
 *   tenancy      - organizations, membership, roles, sessions, invitations,
 *                  audit events, the in-memory repository.
 *   review       - the client three-state review-decision surface
 *                  (a focused subset of tenancy, exposed separately since
 *                  it is the one concept most lanes needed to reference).
 *   geoBusiness  - the full GEO content chain, knowledge through
 *                  human-review-gated article approval.
 *   publication  - the distribution/publication layer specifically
 *                  (a focused subset of geoBusiness).
 */
export * as tenancy from "./tenancy/entities.js";
export * as tenancyAuthorization from "./tenancy/authorization.js";
export * as tenancyAudit from "./tenancy/audit.js";
export * as tenancyInvitations from "./tenancy/invitations.js";
export * as tenancySessions from "./tenancy/sessions.js";
export * as tenancyRepository from "./tenancy/in-memory-repository.js";
export * as review from "./tenancy/review.js";
export * as geoBusiness from "./geo-business/entities.js";
export * as publication from "./geo-business/publication.js";

/**
 * Canonical ID aliases. Deliberately plain `string` aliases, not branded/
 * nominal types (`string & { __brand: ... }`): a real nominal-typing sweep
 * would require touching every fixture and entity field across both
 * entities.ts files and roughly a dozen frontend fixture files, casting
 * every fixture literal - a much larger, riskier change than this
 * acceptance phase's mandate to eliminate *duplicate contract definitions*
 * calls for. What this DOES achieve: one canonical name and one canonical
 * doc-comment per id concept, so a future service signature that wants
 * "a client organization id, not just any string" has somewhere real to
 * import from, and so this acceptance phase's contract-drift test can
 * flag it if a lane ever redeclares an incompatible-looking local alias
 * for the same concept.
 */
export type ClientOrganizationId = string;
export type ProjectId = string;
