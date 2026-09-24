# Production upgrade runbook: ITEMBA-R, 24 September 2026

How to upgrade the live ITEMBA-R to the current `main` **without losing any data**, prove it before touching production, and undo it if needed.

The short version: a deploy upgrades the code *around* the database; it does not replace the database. The data stays in the same Postgres volume, and the deploy script refuses to run against a missing or empty one. What changes the data are the **database migrations** the deploy runs. So we rehearse those migrations on a restored copy of production first, compare the numbers before and after, and only then deploy.

## 1. What this upgrade is

| | |
|---|---|
| Production today | `91d5862b`, deployed 26 Aug 2026 (last successful "Deploy — Production" run) |
| Target | current `main` (at the time of writing `066283d4`) |
| Distance | 115 commits, **57 database migrations** |
| How it deploys | GitHub Actions → **Deploy — Production** (manual, `workflow_dispatch`, typed confirmation). It runs `deploy/relaunch/deploy.sh` on the droplet. |
| Seed | Stays **off**. `RUN_PRODUCTION_SEED` must not be set; seeding would replace role permissions. |
| ITEMBA OS look | Stays **off** unless `NEXT_PUBLIC_ITEMBA_OS_ENABLED=true` is set in `.env.production`. |

### What the 57 migrations do to existing data

None drops a table or a column, and none hard-deletes business records. 53 create new tables or add empty columns. **Four change existing rows**:

| Migration | What it changes | Reversible? |
|---|---|---|
| `20260827020000_supplier_invoice_active_match_uniqueness` | A supplier invoice with more than one *active* three-way match keeps only the newest; the older ones get `deletedAt` set. | Yes: soft delete; the rows stay. |
| `20260829170000_backfill_tax_vat_receivable_account` | Accounts named like "VAT receivable", "VAT recoverable", "Input VAT" or "VAT input" (active, asset, no subtype) are tagged `tax_vat_receivable`. A company with no such account, and with codes 1400/1410 unused, gets a new account **1400 VAT Receivable (Input VAT)**. | Tagging is metadata; the new account has no postings. |
| `20260825350000_audit_scope_provenance` | Every audit log row gets two new fields filled in. On a large `audit_logs` table this is the slowest step and locks that table while it runs. | Additive. |
| `20260827010000_user_dashboard_default_uniqueness` | A user with more than one default dashboard keeps only the latest as default. | Cosmetic. |

(An earlier note also listed the Msaidizi task-event integrity migration. Its table is created by another pending migration, so it touches no existing production data.)

### What users will notice

- **Price editing on the new POS** (#63): the `edit_price` permission reaches Group Super Admin, Company Manager, Branch Manager, Cashier and Salesperson; `edit_price_unlimited` reaches the three manager roles. This only matters on terminals switched to "New POS (pilot)".
- **Account 1400** may appear in some companies' charts (see above).
- New modules arrive: Invoice, Cash and Sales Desks, fuel reports, loan and payroll cash links, stock export.

## 2. Blockers to clear first

1. **Msaidizi posture: decided, option (b).** Since 28 Aug, `deploy.sh` refused to deploy unless *every* Msaidizi switch, including plain chat (`MSAIDIZI_ENABLED`), was `false`. Production has chat on, read-only, so the deploy would have stopped before touching anything. The owner chose to align the deploy check with the app's own release gate (`production-release-gate.service.ts`):
   - chat may be on, but only with `MSAIDIZI_WRITE_MODE=read-only`;
   - every autonomous and device switch must still be `false`.

   This is the PR `deploy-allow-readonly-chat`. **Merge it before deploying.** Then, on the droplet, confirm production's settings fit the new rule: `grep '^MSAIDIZI_' /opt/itemba-r/.env.production` must show `MSAIDIZI_WRITE_MODE=read-only` and no autonomous switch set to `true`.
2. **Access.** Whoever runs this needs SSH to the droplet (for the backup copy and the checks), and "run workflow" rights on the repo. Consider adding required reviewers to the `production` environment in repo Settings → Environments.
3. **Disk space.** Check the droplet has room for a fresh backup plus the new images: `df -h /opt /var/lib/docker`.

## 3. Rehearsal: 1 to 3 days before

Goal: prove, on a copy of real production data, that the backup restores, all 57 migrations apply, and nothing changes except the four items above.

1. **Take a fresh backup on the droplet and copy it off the server**:
   ```bash
   ssh <user>@<droplet> 'cd /opt/itemba-r && bash deploy/relaunch/backup-db.sh'
   ssh <user>@<droplet> 'ls -t /opt/itemba-backups/itemba_r-*.dump.gz | head -1'
   scp <user>@<droplet>:/opt/itemba-backups/<that-file> ./
   ssh <user>@<droplet> 'sha256sum /opt/itemba-backups/<that-file>'
   sha256sum ./<that-file>
   ```
   The two checksums must match. This copy is also your off-server safety net: today's nightly backups only live on the droplet.
2. **Run the rehearsal** on your machine: repo at the release commit, `npm ci` done in `backend/`, Docker running.
   ```bash
   git checkout main && git pull
   bash scripts/upgrade-rehearsal/rehearse.sh ./<that-file>
   ```
   The script:
   - restores the backup into a throwaway Postgres 16 (the version production runs), which proves the backup is restorable;
   - records around 170 numbers per company: row counts, trial balance, a fingerprint of every account balance, stock quantity and value, customer, supplier and cash balances, sales and supplier invoice totals;
   - lists exactly which existing rows the four migrations will change (`preview.txt`);
   - runs `prisma migrate deploy`, the same command production's `backend-migrate` job runs, and times it;
   - records the numbers again and compares them.

   It must end in **REHEARSAL PASSED**. Reports go to `tmp/upgrade-rehearsal/<time>/`.
3. **Review `preview.txt` with whoever owns the accounts**: which matches get soft-deleted, which accounts get tagged, which companies get account 1400. If any of that is wrong for the business, stop and fix the migration first.
4. **Note the migration time** from the report and plan a window of at least three times that, plus 30 minutes for building images and checks.
5. **Optional click-through**: `KEEP=1 bash scripts/upgrade-rehearsal/rehearse.sh ./<that-file>` leaves the upgraded copy running. Point a local backend at the printed `DATABASE_URL` and open the key screens (trial balance, stock, customers, a few documents). Remove it afterwards with `docker rm -f itemba-upgrade-rehearsal`.

If the rehearsal fails, **do not deploy**. It stops at the same point production would, with the reason and the log.

The scripts were tested on 24 Sep: on a copy of the local database, and on a database built at production's exact schema (`91d5862b`) with rows planted to trigger each data-changing migration. All 57 applied, the preview predicted exactly the rows that changed, and a tampered trial balance correctly failed the comparison. `prod-reconcile.sh`'s SSH wrapper has **not** been run against production yet; its in-container command was tested locally.

## 4. Deploy day

| When | Step |
|---|---|
| Day before | Tell users the window and that nothing entered during it is safe until you say so. Confirm the blockers in section 2 are cleared. |
| T−15 min | **Freeze**: users stop entering data (sales, POS, stock, payments). POS terminals queue offline and sync later; check none are mid-sync. |
| T−10 | **Final backup, copied off-server**, as in 3.1. This is the rollback point: note its file name. |
| T−5 | **Record production's numbers** (read-only): `bash scripts/upgrade-rehearsal/prod-reconcile.sh <user>@<droplet> > prod-before.txt` |
| T0 | GitHub → Actions → **Deploy — Production** → Run workflow: `ref` = the rehearsed commit (not just "main", in case main moved), `confirm` = `deploy-production`. The job takes and checks its own backup too, runs the migrations, starts the stack, then verifies the commit, API health and Msaidizi posture. |
| After it finishes | `bash scripts/upgrade-rehearsal/prod-reconcile.sh <user>@<droplet> > prod-after.txt` then `bash scripts/upgrade-rehearsal/compare.sh prod-before.txt prod-after.txt`. It must show only the expected changes, matching the rehearsal. |
| Then | Spot checks as an admin: sign in; trial balance for each company; live stock and value; a customer statement; a supplier balance; open the POS office pages; print one PDF. Numbers must match what users saw before. |
| Then | Lift the freeze; tell users. Watch the backend logs for an hour: `docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend`. |

**Roll back if:** the workflow fails after migrating, `compare.sh` reports unexpected changes, a spot check shows wrong numbers, or the app is unusable. Decide **before** lifting the freeze. Once users enter new data, rolling back loses it.

## 5. Rollback

Rolling back means putting the database back exactly as it was (the T−10 backup) and running the previous code. Migrations only go forward, so there is no "undo migration".

On the droplet, in `/opt/itemba-r`:

```bash
COMPOSE="docker compose --env-file .env.production -f docker-compose.production.yml"

# 1. Stop everything that talks to the database.
$COMPOSE stop backend frontend website

# 2. Recreate the database empty and restore the pre-deploy backup into it.
#    (A fresh database, not --clean: the new tables would otherwise survive.)
$COMPOSE exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\""'
gunzip -c /opt/itemba-backups/<T-10 backup>.dump.gz \
  | $COMPOSE exec -T postgres sh -ec 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner'
```

3. Redeploy the previous code: run **Deploy — Production** with `ref` = `91d5862b`. Its migrations are already applied in the restored database, so it only rebuilds and starts the old code.
4. Record the numbers (`prod-reconcile.sh`) and compare them with `prod-before.txt`. They must be identical.

The rehearsal already proves the key step, restoring that kind of backup into a fresh database. To be certain, practise the full rollback on the rehearsal copy or on staging once.

## 6. After

- Keep the T−10 backup, and the off-server copy, for at least 30 days.
- Put the nightly backups somewhere off the droplet (for example object storage). Today they only live on the server they protect.
- Record the new production commit and date in the release notes.
- Rehearse every future deploy the same way: `rehearse.sh` works for any backup and any release. When a future migration is meant to change other numbers, add those checks to the list at the top of `compare.sh`, in the same PR.

## Files

- `scripts/upgrade-rehearsal/rehearse.sh`: the rehearsal on a copy.
- `scripts/upgrade-rehearsal/reconcile.sql`: the numbers that must not change (read-only).
- `scripts/upgrade-rehearsal/preview.sql`: the existing rows the migrations will change (read-only).
- `scripts/upgrade-rehearsal/compare.sh`: before/after comparison, with the list of expected changes.
- `scripts/upgrade-rehearsal/prod-reconcile.sh`: records the numbers from production over SSH (read-only).
- `deploy/relaunch/backup-db.sh`, `deploy/relaunch/deploy.sh`, `.github/workflows/deploy-production.yml`: the existing backup and deploy path.
