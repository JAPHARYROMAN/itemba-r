import { createServer, createConnection, Socket } from 'node:net';

/** Owned, loopback-only TCP fault boundary. Does not inspect or log DB traffic. */
export async function postgresInterruptionProxy(target: URL) {
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/msaidizi_chat_proof(?:_[a-z0-9]+)?$/.test(target.pathname)
  ) {
    throw new Error('Proxy requires the explicit local disposable proof database');
  }
  const sockets = new Set<Socket>();
  let blocked = false;
  let connections = 0;
  const server = createServer((client) => {
    if (blocked) {
      client.destroy();
      return;
    }
    connections += 1;
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    sockets.add(client);
    sockets.add(upstream);
    for (const [socket, peer] of [
      [client, upstream],
      [upstream, client],
    ]) {
      socket.on('error', () => {
        socket.destroy();
        peer.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        peer.destroy();
      });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = new URL(target);
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as { port: number }).port);
  url.searchParams.set('connect_timeout', '2');
  return {
    url: url.toString(),
    connections: () => connections,
    cut: () => {
      blocked = true;
      const count = sockets.size;
      for (const socket of sockets) socket.destroy();
      return count;
    },
    restore: () => {
      blocked = false;
    },
    close: async () => {
      blocked = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
