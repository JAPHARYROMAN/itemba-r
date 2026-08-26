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

## Forbidden during deployment

Do not run `docker compose down -v`, `docker volume rm`, or
`prisma migrate reset`. Those commands can destroy the persistent database.
