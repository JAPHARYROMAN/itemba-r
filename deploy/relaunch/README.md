# ITEMBA-R safe production deployment

`deploy.sh` preserves the existing Compose volumes and refuses to proceed when
the production Postgres volume or Prisma migration history is missing. For an
existing installation it starts Postgres, creates and verifies a compressed
custom-format dump, and only then builds or runs migrations.

## Normal deployment

```bash
cd /opt/itemba-r
DOMAIN=itembagrouptz.com bash deploy/relaunch/deploy.sh
```

The full seed is skipped during normal deployments because it replaces system
role-permission assignments. Permission-only release changes should be delivered
through Prisma migrations.

Backups are written to `/opt/itemba-backups` before every migration and nightly
at 02:30 UTC. A backup is accepted only after `gzip -t` and `pg_restore --list`
both succeed.

## First installation only

An empty database requires explicit authorization. Seed it only when creating a
new environment:

```bash
cd /opt/itemba-r
ALLOW_EMPTY_DATABASE=true \
RUN_PRODUCTION_SEED=true \
DOMAIN=itembagrouptz.com \
bash deploy/relaunch/deploy.sh
```

Never use either opt-in for routine production updates.

Running the seed against an existing database is blocked unless
`CONFIRM_ROLE_PERMISSION_RESEED=true` is also supplied. That extra confirmation
is reserved for deliberate role-permission maintenance.

## Msaidizi protected ring promotion

The ordinary deployment above intentionally keeps every Msaidizi switch false
and `MSAIDIZI_WRITE_MODE=read-only`. It remains the recovery/default path and
must be run for the exact signed source commit before a ring promotion.

Use the manual `Msaidizi Protected Ring Promotion` GitHub workflow only after a
separate `Msaidizi CRUD Evidence Release` run and independent acceptance of its
promotion inventory, evidence artifact digest, and backend image digest. Its
`verify-only` operation is the default and never contacts production.

The `promote-ring` operation requires:

- required reviewers and self-review prevention on the
  `msaidizi-production-ring-promotion` GitHub environment;
- the purpose-separated CRUD evidence and release P-256 public keys plus their
  exact key IDs;
- production SSH key, pinned `known_hosts`, host, and user settings;
- the protected target ID and three externally accepted digests documented in
  `backend/test/CRUD_EVIDENCE.md`;
- registry read access to the digest-qualified GHCR backend image; and
- a root-owned, non-symbolic, non-group/world-writable ring environment file at
  `MSAIDIZI_RING_ENV_FILE` containing all provider, signing, device, recovery,
  audit, budget, and kill-switch configuration required by the selected ring.
  If autonomous update rollout is enabled, this file must also set
  `MSAIDIZI_UPDATE_AUTOMATIC_MAX_RING` explicitly to `0`, `5`, `25`, or `100`;
  the default `-1` is deliberately non-authorizing.

The target must provide Bash, Node.js 20+, Git, Docker Compose, `flock`, and the
ordinary `/opt/itemba-r` deployment at the signed commit. The promotion does not
run migrations. It replaces only the backend after confirming the existing
dark deployment is healthy, and the separate Compose override removes its build
definition. No mutable tag or source rebuild is an authorized fallback.

Do not type acceptance digests as workflow inputs or derive them in the
promotion job. Missing external acceptance or operational ring evidence is a
failed prerequisite, not something this repository can fabricate.

## Forbidden during deployment

Do not run `docker compose down -v`, `docker volume rm`, or
`prisma migrate reset`. Those commands can destroy the persistent database.
