/** Safety controls for the opt-in restart fixture; subprocesses are mocked. */
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { disposablePostgresRestart } from './fixtures/disposable-postgres-restart';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  realpath: jest.fn(async (value: string) => path.resolve(value)),
}));

describe('Disposable PostgreSQL restart boundary (no subprocesses)', () => {
  const keys = ['MSAIDIZI_CHAT_DISPOSABLE_DB', 'MSAIDIZI_RESTART_PGDATA', 'MSAIDIZI_RESTART_PGCTL'];
  const previous = keys.map((key) => process.env[key]);
  const data = path.join(tmpdir(), `msaidizi-chat-proof-${'a'.repeat(32)}`, 'data');
  const binary = path.join(tmpdir(), 'tools', 'pg_ctl.exe');
  const target = new URL('postgresql://proof@127.0.0.1:55439/msaidizi_chat_proof');
  const control = jest.mocked(execFile);
  const server = () => ({
    directory: data,
    port: 55439,
    database: 'msaidizi_chat_proof',
    address: '127.0.0.1',
    started: 'first-start',
  });
  const client = (
    metadata = server(),
    databases = [{ datname: 'postgres' }, { datname: 'msaidizi_chat_proof' }],
  ) => ({
    $queryRaw: jest.fn(async (query: TemplateStringsArray) =>
      String(query[0]).includes('data_directory') ? [metadata] : databases,
    ),
  });
  beforeEach(() => {
    process.env.MSAIDIZI_CHAT_DISPOSABLE_DB = '1';
    process.env.MSAIDIZI_RESTART_PGDATA = data;
    process.env.MSAIDIZI_RESTART_PGCTL = binary;
    control.mockReset();
    control.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      callback(null, '', '');
      return {} as never;
    });
  });
  afterAll(() =>
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }),
  );

  it.each([
    'missing-opt-in',
    'remote',
    'broad-path',
    'wrong-directory',
    'wrong-port',
    'wrong-database',
    'other-database',
    'wrong-binary',
  ])('refuses unsafe restart targets before invoking anything (%s)', async (scenario) => {
    const metadata = server();
    const databases = [{ datname: 'postgres' }, { datname: 'msaidizi_chat_proof' }];
    const url = new URL(target);
    if (scenario === 'missing-opt-in') delete process.env.MSAIDIZI_CHAT_DISPOSABLE_DB;
    if (scenario === 'remote') url.hostname = 'example.com';
    if (scenario === 'broad-path') process.env.MSAIDIZI_RESTART_PGDATA = tmpdir();
    if (scenario === 'wrong-directory') metadata.directory = path.join(tmpdir(), 'another-cluster');
    if (scenario === 'wrong-port') metadata.port = 5432;
    if (scenario === 'wrong-database') metadata.database = 'production';
    if (scenario === 'other-database') databases.push({ datname: 'shop' });
    if (scenario === 'wrong-binary')
      process.env.MSAIDIZI_RESTART_PGCTL = path.join(tmpdir(), 'cmd.exe');
    await expect(
      disposablePostgresRestart(client(metadata, databases) as never, url),
    ).rejects.toThrow();
    expect(control).not.toHaveBeenCalled();
  });

  it('revalidates cluster contents before stopping and cannot restore an unowned interruption', async () => {
    const databases = [{ datname: 'postgres' }, { datname: 'msaidizi_chat_proof' }];
    const restart = await disposablePostgresRestart(client(server(), databases) as never, target);
    await restart.restore();
    expect(control).not.toHaveBeenCalled();
    databases.push({ datname: 'new-shop' });
    await expect(restart.stop()).rejects.toThrow('other databases');
    expect(control).not.toHaveBeenCalled();
  });

  it('uses the exact validated data directory and refuses uncertain process status', async () => {
    const restart = await disposablePostgresRestart(client() as never, target);
    await restart.stop();
    expect(control).toHaveBeenCalledWith(
      binary,
      ['stop', '-D', data, '-m', 'immediate', '-w', '-t', '15'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
    control.mockImplementationOnce((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error) => void;
      callback(Object.assign(new Error('unknown status'), { code: 4 }));
      return {} as never;
    });
    await expect(restart.restore()).rejects.toThrow('unknown status');
    expect(control).toHaveBeenCalledTimes(2);
  });
});
