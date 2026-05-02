# ITEMBA-R — Tenant Isolation Hardening Notes

## Current implementation slice

This document records the Iteration 2 hardening pattern as it is introduced across the backend.

## Shared scope source

`CompanyScopeService` is the shared service for company and group-scope checks. It should be used by services that read or mutate company-owned, group-level, or sensitive records.

The authenticated request user now carries:

- `roleScopes`: role scope values such as `GROUP` or `COMPANY`
- `companyId`: the user's primary company, when present
- `companyAccess`: explicit company access grants from `UserCompanyAccess`

## Enforcement rules

Use these defaults unless a module has a documented exception:

- Group-level records require a `GROUP` scoped role.
- Company-owned reads require at least `READ` access to the owning company.
- Company-owned writes require `WRITE` or `MANAGE`, depending on risk.
- Security-sensitive lifecycle actions, such as API key creation/revocation, require `MANAGE`.
- Group-control modules, such as bank accounts, require a `GROUP` scoped role even when records are company-owned.

## Modules hardened in this slice

| Module | Enforcement added |
|---|---|
| `bank-accounts` | Requires `GROUP` scope for list/detail/create/update/delete/summary; validates company ownership on writes/deletes |
| `api-keys` | Filters list results by accessible API-client company; validates company access for detail/create/revoke |

## Test coverage

`CompanyScopeService` has focused unit coverage for:

- group-scope access
- denial of group-level access to non-group users
- primary-company access
- explicit `UserCompanyAccess` grants
- minimum access-level checks
- fallback DB access lookup

## Next modules to harden

Recommended order:

1. `api-clients`
2. `users`, `roles`, `permissions`
3. `payroll-runs`, `salary-payments`, `employees`
4. `journal-entries`, `accounting-periods`, `accounting-locks`
5. remaining Group Control modules: loans, debts, contracts, fixed assets

