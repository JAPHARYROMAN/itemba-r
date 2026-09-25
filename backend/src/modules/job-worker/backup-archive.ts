import { createHash } from 'crypto';
import { constants, promises as fs, Stats } from 'fs';
import * as path from 'path';
import { Zip, ZipPassThrough } from 'fflate';

export const SUPPORTED_BACKUP_TYPES = ['DATABASE', 'FILE_STORAGE', 'DOCUMENTS', 'FULL_SYSTEM'];

export function validateBackupSupport(type: string, target = 'LOCAL'): void {
  if (!SUPPORTED_BACKUP_TYPES.includes(type)) {
    throw new Error(
      `Backup type ${type} is not implemented. Choose database, files or full system.`,
    );
  }
  if (target !== 'LOCAL') {
    throw new Error(
      'Only LOCAL backup storage is implemented. Configure off-server replication separately.',
    );
  }
}

export function backupCoverageWarning(record: {
  status?: string;
  backupType?: string;
  metadata?: unknown;
}): string | null {
  if (record.status !== 'COMPLETED') return null;
  const metadata =
    record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};
  if (record.backupType === 'DATABASE') return null;
  if (
    ['FILE_STORAGE', 'DOCUMENTS', 'FULL_SYSTEM'].includes(record.backupType ?? '') &&
    metadata.artifactFormat === 'itemba-backup/zip-v1' &&
    metadata.filesIncluded === true &&
    (record.backupType !== 'FULL_SYSTEM' || metadata.databaseIncluded === true)
  )
    return null;
  return 'File coverage is not verified for this older backup. It may contain only a database dump. Create and restore-test a new full backup before relying on it.';
}

interface BackupFile {
  source: string;
  name: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

export interface StorageSnapshot {
  roots: Array<{ name: string; directory: string }>;
  files: BackupFile[];
  backupsDirectory: string;
}

// fflate writes ZIP32. Refuse oversized input rather than emitting a corrupt archive.
// The margin accommodates headers, the manifest and directory entries.
const MAX_ARCHIVE_INPUT_BYTES = 0xf0000000;
const MAX_ARCHIVE_FILES = 50_000;

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function sameFile(file: BackupFile, stat: Stats): boolean {
  return (
    stat.isFile() &&
    stat.size === file.size &&
    stat.mtimeMs === file.mtimeMs &&
    stat.ino === file.ino
  );
}

async function scanRoots(
  snapshot: Omit<StorageSnapshot, 'files'>,
  signal?: AbortSignal,
): Promise<BackupFile[]> {
  const files: BackupFile[] = [];
  for (const root of snapshot.roots) {
    async function visit(directory: string, depth: number): Promise<void> {
      signal?.throwIfAborted();
      if (depth > 64) throw new Error('Backup storage nesting exceeds 64 directories.');
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const source = path.join(directory, entry.name);
        signal?.throwIfAborted();
        if (within(snapshot.backupsDirectory, source)) continue;
        if (entry.isSymbolicLink())
          throw new Error(
            'Backup storage contains a symbolic link; capture the real storage root instead.',
          );
        if (entry.isDirectory()) await visit(source, depth + 1);
        else if (entry.isFile()) {
          const relative = path.relative(root.directory, source).split(path.sep).join('/');
          if (Buffer.byteLength(relative) > 1024)
            throw new Error('A storage path exceeds the portable archive limit of 1,024 bytes.');
          if (/[\\\x00-\x1f:]/.test(relative))
            throw new Error('A storage filename is not portable in a backup archive.');
          const stat = await fs.lstat(source);
          if (!stat.isFile()) throw new Error('Storage changed during backup inventory.');
          files.push({
            source,
            name: `files/${root.name}/${relative}`,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ino: stat.ino,
          });
        } else throw new Error('Backup storage contains an unsupported special file.');
        if (files.length > MAX_ARCHIVE_FILES)
          throw new Error(
            'Local ZIP backups support at most 50,000 files; use an external storage snapshot for this dataset.',
          );
      }
    }
    await visit(root.directory, 0);
  }
  return files;
}

export async function snapshotLocalStorage(
  backupsDirectory: string,
  signal?: AbortSignal,
): Promise<StorageSnapshot> {
  if ((process.env.STORAGE_DRIVER ?? 'local').toLowerCase() !== 'local') {
    throw new Error(
      'File and full backups require local storage. Back up remote objects with the configured storage provider.',
    );
  }
  const configuredRoot =
    process.env.STORAGE_LOCAL_PATH ??
    process.env.LOCAL_STORAGE_PATH ??
    process.env.STORAGE_PATH ??
    path.join(process.cwd(), 'uploads');
  const roots: StorageSnapshot['roots'] = [];
  const candidates = [
    { name: 'storage', directory: configuredRoot, required: true },
    { name: 'legacy-uploads', directory: path.join(process.cwd(), 'uploads'), required: false },
    ...(process.env.EXPORTS_DIR
      ? [{ name: 'exports', directory: process.env.EXPORTS_DIR, required: true }]
      : []),
  ];
  const resolvedBackups = await fs.realpath(backupsDirectory);
  for (const candidate of candidates) {
    let directory: string;
    try {
      directory = await fs.realpath(candidate.directory);
    } catch (error) {
      if (!candidate.required && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(
        `Backup source ${candidate.name} is unavailable. Configure and mount its storage directory.`,
      );
    }
    if (!(await fs.stat(directory)).isDirectory())
      throw new Error(`Backup source ${candidate.name} is not a directory.`);
    if (directory === path.parse(directory).root)
      throw new Error('A filesystem root cannot be used as backup storage.');
    if (within(resolvedBackups, directory))
      throw new Error('A backup source cannot be inside BACKUPS_DIR.');
    if (roots.some((root) => within(root.directory, directory))) continue;
    if (roots.some((root) => within(directory, root.directory)))
      throw new Error('Backup storage roots overlap; configure distinct roots.');
    roots.push({ name: candidate.name, directory });
  }
  const snapshot = { roots, backupsDirectory: resolvedBackups };
  return { ...snapshot, files: await scanRoots(snapshot, signal) };
}

export async function assertStorageUnchanged(
  snapshot: StorageSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  const current = await scanRoots(snapshot, signal);
  if (JSON.stringify(current) !== JSON.stringify(snapshot.files)) {
    throw new Error('Files changed during backup. Retry when uploads and file deletion are quiet.');
  }
}

export async function writeBackupArchive(options: {
  destination: string;
  backupType: string;
  snapshot: StorageSnapshot;
  databaseFile?: string;
  signal?: AbortSignal;
}): Promise<{ fileCount: number; sourceBytes: number }> {
  const files = [...options.snapshot.files];
  if (options.databaseFile) {
    const stat = await fs.lstat(options.databaseFile);
    if (!stat.isFile()) throw new Error('Database backup is not a regular file.');
    files.unshift({
      source: options.databaseFile,
      name: 'database.sql',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ino: stat.ino,
    });
  }
  const sourceBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (sourceBytes > MAX_ARCHIVE_INPUT_BYTES || files.length > MAX_ARCHIVE_FILES) {
    throw new Error(
      'Dataset exceeds the local ZIP backup limit (3.75 GiB / 50,000 files). Use an external database and storage snapshot.',
    );
  }
  const output = await fs.open(options.destination, 'wx', 0o600);
  const chunks: Uint8Array[] = [];
  let archiveError: Error | null = null;
  let ended = false;
  const archive = new Zip((error, chunk, final) => {
    if (error) archiveError = error;
    else chunks.push(chunk);
    if (final) ended = true;
  });
  async function flush() {
    if (archiveError) throw archiveError;
    for (const chunk of chunks.splice(0)) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await output.write(chunk, offset, chunk.byteLength - offset);
        if (!written.bytesWritten) throw new Error('Backup archive write made no progress.');
        offset += written.bytesWritten;
      }
    }
  }
  const manifestFiles: Array<{ path: string; bytes: number; sha256: string }> = [];
  try {
    for (const file of files) {
      options.signal?.throwIfAborted();
      const handle = await fs.open(file.source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        if (!sameFile(file, await handle.stat()))
          throw new Error('A file changed before backup capture.');
        const entry = new ZipPassThrough(file.name);
        archive.add(entry);
        await flush();
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({
          autoClose: false,
          highWaterMark: 64 * 1024,
        })) {
          options.signal?.throwIfAborted();
          hash.update(chunk);
          entry.push(chunk, false);
          await flush();
        }
        if (!sameFile(file, await handle.stat()) || !sameFile(file, await fs.lstat(file.source))) {
          throw new Error('A file changed during backup capture.');
        }
        entry.push(new Uint8Array(), true);
        await flush();
        manifestFiles.push({ path: file.name, bytes: file.size, sha256: hash.digest('hex') });
      } finally {
        await handle.close();
      }
    }
    await assertStorageUnchanged(options.snapshot, options.signal);
    const manifest = new ZipPassThrough('manifest.json');
    archive.add(manifest);
    manifest.push(
      Buffer.from(
        JSON.stringify(
          {
            schemaVersion: 1,
            backupType: options.backupType,
            createdAt: new Date().toISOString(),
            databaseIncluded: Boolean(options.databaseFile),
            storageRoots: options.snapshot.roots.map((root) => root.name),
            files: manifestFiles,
            recoveryRequirements: [
              'Restore into an isolated empty destination and verify every file hash.',
              'Encryption keys and deployment secrets must be recovered separately from the approved secret store.',
              'Replicate the completed archive off the application host.',
            ],
          },
          null,
          2,
        ),
      ),
      true,
    );
    archive.end();
    await flush();
    if (!ended) throw new Error('Backup archive did not finish.');
    await output.sync();
    return { fileCount: manifestFiles.length, sourceBytes };
  } catch (error) {
    archive.terminate();
    throw error;
  } finally {
    await output.close();
  }
}
