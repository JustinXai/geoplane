# SYSTEM_INVARIANTS_V1 (frozen)

Rules that must hold across every module of this rebuild, regardless of
which agent or which priority tier is being worked on.

## Tenant isolation

- A `CLIENT` user belongs to at most one **ACTIVE** `CLIENT` organization.
- An `AGENCY` user may only act on `CLIENT` organizations it has an
  explicit, active assignment to — no implicit or wildcard access.
- A `PLATFORM` user may act on any organization.
- No query, migration, or fixture may assume a single-tenant world.

## Publication

- Platform-neutral by default: never auto-select the client's own website
  or a specific large platform as a default target.
- No automatic publication under any circumstance.
- External publisher integrations (e.g. a WeChatSync-style bridge) are
  future, opt-in, explicit — never wired in as a default path.

## Recovery/reconstruction boundary

- Recovered evidence and reconstructed-from-spec code must never be
  presented as the same thing. Every file lands in exactly one of class A
  (`VERIFIED_RECOVERED_SOURCE`), B (`PARTIAL_RECOVERED_SOURCE`), or C
  (`RECONSTRUCTED_FROM_FROZEN_SPEC`) — see
  `docs/rebuild/REBUILD_MASTER_PLAN.md` §3.
- No git commit SHA from the lost history may be reused or fabricated in
  this repository.

## No customer data, no secrets

- No real customer attachments, evidence, or raw provider responses.
- No real email addresses or phone numbers.
- No API keys, database credentials, JWT/session secrets, invitation
  tokens, or cookies — in code, fixtures, or test data. Use obviously
  fake values (e.g. `CHANGE_ME`, `test@example.com`) in anything committed
  while this repository is public.

## Determinism where the business chain requires it

Recovered evidence shows at least one part of this system was designed
around deterministic, zero-external-call regression tests (structured
output: `{status, briefs, provider_calls, database_writes,
fabricated_defaults}`). Any reconstruction of that chain must preserve
this property — provider calls and database writes must be `0` in that
test mode, not merely mocked to appear as `0`.
