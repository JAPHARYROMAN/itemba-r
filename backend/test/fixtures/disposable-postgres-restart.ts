import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PrismaService } from '../../src/prisma/prisma.service';

const execute = promisify(execFile);

/** Opt-in only. Never accepts a shared service, container, or arbitrary PGDATA. */
export async function disposablePostgresRestart(prisma: PrismaService, target: URL) {
  const configuredData = process.env.MSAIDIZI_RESTART_PGDATA;
  const pgctl = process.env.MSAIDIZI_RESTART_PGCTL;
  if (!configuredData || !pgctl || process.env.MSAIDIZI_CHAT_DISPOSABLE_DB !== '1')
    throw new Error('PostgreSQL restart requires explicit disposable-cluster opt-in');
  if (
    target.hostname !== '127.0.0.1' ||
    !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(target.pathname)
  )
    throw new Error('PostgreSQL restart requires the loopback proof database');
  const data = await realpath(configuredData);
  const temporary = await realpath(tmpdir());
  const relative = path.relative(temporary, data);
  const parts = relative.split(path.sep);
  if (
    parts.length !== 2 ||
    !/^msaidizi-chat-proof-[a-f0-9]{32}$/.test(parts[0]) ||
    parts[1] !== 'data'
  )
    throw new Error('PostgreSQL restart target is not an owned temporary proof cluster');
  const binary = await realpath(pgctl);
  if (!['pg_ctl', 'pg_ctl.exe'].includes(path.basename(binary)))
    throw new Error('PostgreSQL restart requires an explicit pg_ctl executable');

  const inspect = async () => {
    const [server] = await prisma.$queryRaw<
      Array<{ directory: string; port: number; database: string; address: string; started: string }>
    >`
      SELECT current_setting('data_directory') AS directory, inet_server_port() AS port,
        current_database() AS database, host(inet_server_addr()) AS address,
        pg_postmaster_start_time()::text AS started`;
    if (
      !server ||
      (await realpath(server.directory)) !== data ||
      server.address !== '127.0.0.1' ||
      server.database !== target.pathname.slice(1) ||
      server.port !== Number(target.port)
    )
      throw new Error('PostgreSQL connection does not match the exact restart target');
    const databases = await prisma.$queryRaw<
      Array<{ datname: string }>
    >`SELECT datname FROM pg_database WHERE NOT datistemplate`;
    if (databases.some((row) => row.datname !== 'postgres' && row.datname !== server.database))
      throw new Error('Refusing to restart a cluster containing other databases');
    return server;
  };
  const original = await inspect();
  let ownsInterruption = false;
  const control = (...args: string[]) =>
    execute(binary, args, { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return {
    originalStart: original.started,
    stop: async () => {
      await inspect(); // Revalidate the resolved target immediately before interruption.
      ownsInterruption = true;
      await control('stop', '-D', data, '-m', 'immediate', '-w', '-t', '15');
    },
    restore: async () => {
      if (!ownsInterruption) return;
      let running = false;
      try {
        await control('status', '-D', data);
        running = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 3) throw error;
      }
      if (!running)
        await control(
          'start',
          '-D',
          data,
          '-l',
          path.join(path.dirname(data), `restart-${randomUUID()}.log`),
          '-o',
          `-p ${original.port} -h 127.0.0.1`,
          '-w',
          '-t',
          '15',
        );
      await inspect();
      ownsInterruption = false;
    },
    inspect,
  };
}
