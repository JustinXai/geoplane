# SANITIZED LOCAL ACCOUNT REFERENCE — TEMPLATE

This committed template contains no credentials. Complete the status fields in Git if useful; store account identifiers and passwords only in an approved local secret store outside the repository.

| Role | Sanitized purpose | Account identifier location | Password location | Membership expected | Status |
| --- | --- | --- | --- | --- | --- |
| Platform Admin | Local platform administration | Out-of-band secret store | Out-of-band secret store | Platform organization / admin | NOT_RECORDED |
| Agency Owner | Manage only assigned sanitized client | Out-of-band secret store | Out-of-band secret store | Sanitized agency / owner | NOT_RECORDED |
| Client Owner | Operate only own sanitized organization | Out-of-band secret store | Out-of-band secret store | Sanitized client / owner | NOT_RECORDED |

Sanitized tenant inventory:

| Object | Required count | Value storage | Status |
| --- | ---: | --- | --- |
| Agency | 1 | PostgreSQL runtime database | NOT_VERIFIED |
| Client organization | 1 | PostgreSQL runtime database | NOT_VERIFIED |
| Project | 1 | PostgreSQL runtime database | NOT_VERIFIED |
| Agency-client assignment | 1 | PostgreSQL runtime database | NOT_VERIFIED |

Rules:

- Use invented organization, person, project, document, and domain names.
- Never reuse a real email address, phone number, customer file, password, API key, or signing key.
- Do not place session cookies or reset tokens in this document.
- Seed output may confirm created roles and counts but must not print credentials.
