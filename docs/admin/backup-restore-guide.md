# Backup and recovery

This guide describes the implemented release candidate. A completed backup and a
valid checksum do not prove recovery. Production readiness requires a restore of
the actual database, uploaded files and required encryption keys on a separate host.

## What the application captures

| Backup type              | Artifact                                    | Coverage                                                     |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Database                 | Plain SQL from `pg_dump`                    | Database only                                                |
| File storage / Documents | ZIP with `manifest.json`                    | All configured local files, including documents; no database |
| Full system              | ZIP with `database.sql`, files and manifest | Database and configured local files                          |

The runtime installs the PostgreSQL **16** client to match the PostgreSQL 16
compose services. A newer dump client can generate SQL that the original server
cannot restore. Verify `pg_dump --version`, the source server version and the
target restore version before changing either runtime.

File roots are `STORAGE_LOCAL_PATH` (legacy aliases `LOCAL_STORAGE_PATH` and
`STORAGE_PATH`), the application's legacy `uploads` directory when distinct, and
`EXPORTS_DIR` when configured. The default primary root is `uploads` under the
backend working directory. Mount every configured root into the worker container.
The archive records named roots (`storage`, `legacy-uploads`, `exports`); restore
them to the corresponding destination paths, not to an arbitrary common directory.

`BACKUPS_DIR` selects the artifact destination. It is excluded from captured files.
Each archive includes a SHA-256 hash and byte count for every file. Artifacts are
written privately to temporary files and published only after successful capture.
Failed and cancelled attempts remove their own partial artifacts.

Only **LOCAL** destinations are implemented. S3, Azure, SFTP, configuration-only,
audit-only and custom backup types are rejected instead of reporting false success.
Remote object storage must use a separately configured provider backup process.

Local ZIP limits are **3.75 GiB total input and 50,000 files**, including SQL for a
full backup. Larger datasets require an external database and storage snapshot.
Symbolic links, special files, overlapping roots and nonportable names are rejected.
Files are inventoried before the database dump and checked again during and after
capture. Changes cause the backup to fail; retry during a quiet upload/deletion
window. This is not a transactional snapshot of the filesystem: production recovery
must still verify every referenced document and wallpaper.

Older file/full runs may contain SQL only, despite a Completed status. The Runs
screen labels these **Review required**. Create and restore-test a new full backup
before relying on file coverage. Existing backups are not rewritten automatically.

## Scheduling, retention and off-server copies

Application job schedules require the job scheduler and worker to be enabled and
healthy. Verify a scheduled run actually completes. The job's retention-days field
records the requested policy; the application worker does not automatically prune
or replicate its artifacts. Operators must implement and test both separately.

The host deployment script installs a separate database-only nightly job:

- `deploy/relaunch/backup-db.sh` writes a gzip-wrapped custom-format PostgreSQL dump.
- Default destination: `/opt/itemba-backups`; default retention: 14 days.
- The crontab entry is `30 2 * * *`, interpreted in the host's cron timezone.
  The deployment summary assumes UTC; verify the actual host timezone.
- `gzip -t` and `pg_restore --list` check readability. They do **not** restore rows
  or validate application behavior, and they do not capture uploaded files.

There is no configured WAL archive/PITR, monthly retention tier, off-server copy
or delivered failure alert merely because this guide exists. Agree recovery time
and data-loss targets with the business owner, then implement and rehearse them.

Replicate completed artifacts to an access-controlled off-server location. Exclude
partial files, verify the transferred hash and protect backups at rest. Retain the
last proven restore until a newer independent restore succeeds. Recover deployment
secrets and data-encryption keys from the approved secret store; they are deliberately
not exported into these archives. Losing a key can make restored data unusable.

## Restore rehearsal

1. Record the candidate SHA, image digests, PostgreSQL version, archive checksum,
   backup time, key identifiers and expected business control totals. Obtain an
   authorised data copy and use an isolated destination with outbound mail and
   payment integrations disabled.
2. Verify the whole-artifact hash against the saved BackupRun. Extract a trusted
   ZIP into an empty private directory using tooling that rejects path traversal,
   symbolic links and duplicate paths. Match the manifest file inventory, sizes
   and SHA-256 hashes. Inspect archive size before extraction; avoid loading a
   production archive entirely into memory.
3. Create a **new** empty recovery database. For application SQL, restore using
   `psql --set ON_ERROR_STOP=1 --single-transaction --file database.sql`. Supply the
   recovery database explicitly and use a protected password file or environment;
   do not put credentials in command arguments. For the host custom-format backup,
   decompress into private storage and use `pg_restore --exit-on-error` instead.
   Never drop or overwrite the live database as a rehearsal shortcut.
4. Restore each named file root to its configured recovery mount with the worker's
   ownership and private permissions. Restore required keys separately. Confirm
   database document/wallpaper references resolve to the expected file bytes.
5. Apply the intended migrations to the recovery copy and start the pinned backend
   against it. Verify readiness, sign-in and appropriate access boundaries. Compare
   business row hashes/control totals, unpaid invoices, cash, loans, journals and
   stock. Open representative documents and exports, including encrypted data.
6. Rehearse recovery from the **off-server** copy and confirm alert delivery with
   the responsible operator. Record measured restore time and data-loss interval.
   Test the previous application's compatibility with migrated data before using
   an old image as a rollback strategy. Agree the cutover decision separately.

`scripts/prove-full-backup.cjs` exercises the real worker, `pg_dump`, file hashes,
`psql` and database-content comparison against the guarded synthetic release
database. It creates and removes only its newly generated recovery database.
This is local integration evidence, not a production restore utility or acceptance.

## Monitoring acceptance

Monitor missed scheduled runs, failed/cancelled runs, artifact age and size,
off-server transfer failures, free disk space and failed restore verification.
Send a test failure through the real alert channel and confirm someone receives it.
Readiness failure, process liveness and backup completion are separate signals.
Record owners, escalation, retention, recovery targets and the last successful
restore in the release handoff before approving production.
