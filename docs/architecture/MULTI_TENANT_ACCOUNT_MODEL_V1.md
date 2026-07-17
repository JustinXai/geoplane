# MULTI_TENANT_ACCOUNT_MODEL_V1 (frozen)

Status: frozen design restated by the project owner, not a recovered
artifact — see the status note in `SYSTEM_BLUEPRINT_V1.md`. This is the
authoritative target for any class-C reconstruction of the tenancy/auth
line.

## Organization types

- `PLATFORM`
- `AGENCY`
- `CLIENT`

## Account rules

- A `CLIENT` user may belong to at most one **ACTIVE** `CLIENT`
  organization at a time.
- An `AGENCY` user manages multiple `CLIENT` organizations, but only ones
  it has been explicitly granted access to (explicit assignment, not
  implicit/wildcard access).
- A `PLATFORM` user can manage all organizations.

## Evidence corroboration

7 real source files were recovered with lost original paths (class B,
`recovered/partial-source/`) that are directly consistent with this model
and give it independent, code-level support (not just the owner's
recollection):

- `OrganizationCreateForm` accepting a `type` of `"AGENCY"` or `"CLIENT"`
  (two separate recovered pages construct it with each type explicitly).
- `ProjectCreateForm` scoped to a list of `CLIENT`-type organizations only.
- `AssignmentForm` over `tenancyRepository.listOrganizations()`, described
  in-page as: "只有有效分配中的客户可被代理商选择" (only clients within
  an active assignment can be selected by an agency) — a direct code-level
  match for the "explicit assignment" rule above.
- `AgencyClientCreateForm`, described in-page as: "客户将自动分配给当前代理商"
  (the client is automatically assigned to the current agency) — the
  agency-created-client flow.
- `tenancyRepository.revokeInvitation({ invitationId, actor, now })` behind
  `requireSurfaceAuthorization("ops")` — an ops-gated invitation-revocation
  path.
- `tenancyRepository.listAudit()` rendering actor/action/target/timestamp —
  confirms an audit-log surface keyed to real actor IDs, not anonymized
  data.

None of this recovered evidence contradicts the frozen model above; it
corroborates it at the code level for the account/organization/invitation
surface specifically.

## Cross-cutting concerns implied by both sources

- tenancy, organization, membership, project, invitation, session, audit —
  P1 priority per `docs/rebuild/REBUILD_MASTER_PLAN.md`.
