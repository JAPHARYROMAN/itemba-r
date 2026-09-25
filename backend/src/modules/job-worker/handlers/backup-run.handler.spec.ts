import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unzipSync } from 'fflate';
import { BackupRunJobHandler } from './backup-run.handler';
import { backupCoverageWarning, snapshotLocalStorage, writeBackupArchive } from '../backup-archive';

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn() }));

describe('Backup artifacts contain the requested recovery data', () => {
  let root: string;
  let storage: string;
  let backups: string;
  let originalEnv: NodeJS.ProcessEnv;
  let cwd: jest.SpyInstance;
  const sql = '-- synthetic database backup\nSELECT 1;\n';
  const run = {
    id: 'run',
    backupRunNumber: 'BR-TEST',
    backupType: 'DATABASE',
    status: 'REQUESTED',
    metadata: {},
    backupJob: { storageTarget: 'LOCAL' },
  };
  const dump = execFile as unknown as jest.Mock;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'itemba-backup-test-'));
    cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    storage = path.join(root, 'storage');
    backups = path.join(storage, 'backups');
    await fs.mkdir(backups, { recursive: true });
    await fs.mkdir(path.join(storage, 'documents'));
    await fs.writeFile(
      path.join(storage, 'documents', 'invoice.pdf'),
      Buffer.from('Synthetic PDF\x00\xff', 'binary'),
    );
    await fs.writeFile(path.join(storage, 'empty.txt'), '');
    await fs.writeFile(
      path.join(backups, 'previous.sql'),
      'Old backup must not be archived recursively',
    );
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_PATH = storage;
    process.env.BACKUPS_DIR = backups;
    delete process.env.EXPORTS_DIR;
    process.env.DATABASE_URL =
      'postgresql://fixture:private-test-password@localhost:5432/fixture?connection_limit=2';
    dump.mockReset();
    dump.mockImplementation((_command, args, _options, callback) => {
      const filename = args.find((arg: string) => arg.startsWith('--file=')).slice(7);
      void fs.writeFile(filename, sql).then(() => callback(null, '', ''), callback);
    });
  });

  afterEach(async () => {
    cwd.mockRestore();
    process.env = originalEnv;
    // Only the exact unique temporary directory created by this test is removed.
    if (!root.startsWith(path.join(os.tmpdir(), 'itemba-backup-test-')))
      throw new Error('Unexpected test directory');
    await fs.rm(root, { recursive: true, force: true });
  });

  function handler(overrides: Record<string, unknown> = {}) {
    const updates = jest.fn().mockResolvedValue({});
    const prisma = {
      backupRun: {
        findUnique: jest.fn().mockResolvedValue({ ...run, ...overrides }),
        update: updates,
      },
      $transaction: jest.fn(async (callback) =>
        callback({ backupRun: { update: updates }, backupJob: { update: jest.fn() } }),
      ),
    };
    const registry = { register: jest.fn() };
    new BackupRunJobHandler(prisma as any, registry as any).onModuleInit();
    return {
      execute: (context: Record<string, unknown> = {}) =>
        registry.register.mock.calls[0][1]({ payload: { backupRunId: 'run' }, ...context }),
      updates,
    };
  }

  function completed(updates: jest.Mock) {
    return updates.mock.calls.find(([args]) => args.data.status === 'COMPLETED')?.[0].data;
  }

  it('keeps database SQL backups compatible and never puts the password in command arguments', async () => {
    const proof = handler();
    await proof.execute();
    const saved = completed(proof.updates);
    expect(await fs.readFile(saved.filePath, 'utf8')).toBe(sql);
    expect(saved.metadata).toMatchObject({
      artifactFormat: 'pg_dump/plain-sql',
      databaseIncluded: true,
      filesIncluded: false,
    });
    expect(dump.mock.calls[0][1].join(' ')).not.toContain('private-test-password');
    expect(dump.mock.calls[0][2].env.PGPASSWORD).toBe('private-test-password');
    expect(saved.checksum).toBe(createHash('sha256').update(sql).digest('hex'));
  });

  it('does not capture or publish after worker cancellation', async () => {
    const proof = handler({ backupType: 'FULL_SYSTEM' });
    await expect(proof.execute({ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(dump).not.toHaveBeenCalled();
    expect(completed(proof.updates)).toBeUndefined();
    expect(proof.updates).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(await fs.readdir(backups)).toEqual(['previous.sql']);
  });

  it('flags legacy database-only full backups for operator review', () => {
    expect(
      backupCoverageWarning({
        backupType: 'FULL_SYSTEM',
        status: 'COMPLETED',
        metadata: { artifactFormat: 'pg_dump/plain-sql' },
      }),
    ).toMatch(/only a database dump/);
    expect(
      backupCoverageWarning({
        backupType: 'FULL_SYSTEM',
        status: 'COMPLETED',
        metadata: {
          artifactFormat: 'itemba-backup/zip-v1',
          filesIncluded: true,
          databaseIncluded: true,
        },
      }),
    ).toBeNull();
  });

  it('full backups round-trip SQL, binary and empty files with individual hashes', async () => {
    const proof = handler({ backupType: 'FULL_SYSTEM' });
    await proof.execute();
    const saved = completed(proof.updates);
    const archive = unzipSync(await fs.readFile(saved.filePath));
    const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString());
    expect(Buffer.from(archive['database.sql']).toString()).toBe(sql);
    expect(Buffer.from(archive['files/storage/documents/invoice.pdf'])).toEqual(
      await fs.readFile(path.join(storage, 'documents/invoice.pdf')),
    );
    expect(archive['files/storage/empty.txt']).toHaveLength(0);
    expect(Object.keys(archive).some((name) => name.includes('previous.sql'))).toBe(false);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      backupType: 'FULL_SYSTEM',
      databaseIncluded: true,
    });
    expect(manifest.files).toHaveLength(3);
    for (const file of manifest.files) {
      expect(archive[file.path]).toHaveLength(file.bytes);
      expect(createHash('sha256').update(archive[file.path]).digest('hex')).toBe(file.sha256);
    }
    expect(saved.metadata).toMatchObject({
      artifactFormat: 'itemba-backup/zip-v1',
      databaseIncluded: true,
      filesIncluded: true,
    });
    expect(
      (await fs.readdir(backups)).some(
        (name) => name.includes('.database-') || name.includes('.tmp-'),
      ),
    ).toBe(false);
  });

  it('file backups do not invoke pg_dump or require a database connection setting', async () => {
    delete process.env.DATABASE_URL;
    const proof = handler({ backupType: 'FILE_STORAGE' });
    await proof.execute();
    expect(dump).not.toHaveBeenCalled();
    const archive = unzipSync(await fs.readFile(completed(proof.updates).filePath));
    expect(archive['database.sql']).toBeUndefined();
    expect(archive['files/storage/documents/invoice.pdf']).toBeDefined();
  });

  it('does not accept an old database-only artifact as a completed full backup', async () => {
    const proof = handler({
      backupType: 'FULL_SYSTEM',
      status: 'COMPLETED',
      filePath: path.join(backups, 'previous.sql'),
      checksum: 'old',
      metadata: { artifactFormat: 'pg_dump/plain-sql' },
    });
    await proof.execute();
    expect(completed(proof.updates).metadata.filesIncluded).toBe(true);
  });

  it.each([
    { backupType: 'CONFIGURATION' },
    { backupType: 'DATABASE', backupJob: { storageTarget: 'S3_COMPATIBLE' } },
  ])(
    'fails unsupported coverage or storage instead of recording a successful database dump: %j',
    async (overrides) => {
      const proof = handler(overrides);
      await expect(proof.execute()).rejects.toThrow();
      expect(dump).not.toHaveBeenCalled();
      expect(completed(proof.updates)).toBeUndefined();
      expect(proof.updates).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    },
  );

  it('fails and removes temporary artifacts when a referenced file changes during the database snapshot', async () => {
    dump.mockImplementation((_command, args, _options, callback) => {
      void (async () => {
        await fs.writeFile(args.find((arg: string) => arg.startsWith('--file=')).slice(7), sql);
        await fs.writeFile(
          path.join(storage, 'documents', 'invoice.pdf'),
          'A different invoice during capture',
        );
      })().then(() => callback(null, '', ''), callback);
    });
    const proof = handler({ backupType: 'FULL_SYSTEM' });
    await expect(proof.execute()).rejects.toThrow(/changed/);
    expect(completed(proof.updates)).toBeUndefined();
    expect(await fs.readdir(backups)).toEqual(['previous.sql']);
  });

  it('rejects a storage junction/symlink instead of following it outside the storage root', async () => {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'outside storage');
    await fs.symlink(
      outside,
      path.join(storage, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(snapshotLocalStorage(backups)).rejects.toThrow(/symbolic link/);
  });

  it('rejects oversized ZIP input before creating an artifact', async () => {
    const snapshot = await snapshotLocalStorage(backups);
    snapshot.files[0].size = 0x1_0000_0000;
    const destination = path.join(backups, 'oversized.zip');
    await expect(
      writeBackupArchive({ destination, backupType: 'FILE_STORAGE', snapshot }),
    ).rejects.toThrow(/limit/);
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
