# Migration Safety Policy

New migrations that drop tables or columns must include both safeguards:

- A `-- destructive-ok:` comment that explains the operational reason and rollback expectation.
- An `archive_*` copy step before the destructive change when the dropped data can exist in production.

Historical destructive migrations are explicitly allowlisted in `scripts/validate-migration-safety.mjs` because they have already shipped. They should not be used as precedent for new work.

The Prisma schema now uses `uuid()` as the single client-side default for string primary keys. Existing CUID rows remain valid because IDs are stored as strings; new records are generated as UUIDs.
