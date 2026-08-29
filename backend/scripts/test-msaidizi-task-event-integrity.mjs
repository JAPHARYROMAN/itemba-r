import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.MSAIDIZI_LEDGER_TEST_DATABASE_URL;
const databaseAck = process.env.MSAIDIZI_LEDGER_TEST_DATABASE_ACK;

if (process.env.MSAIDIZI_LEDGER_TEST_ALLOW_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Set MSAIDIZI_LEDGER_TEST_ALLOW_DISPOSABLE_DATABASE=true explicitly');
}
if (!databaseUrl) throw new Error('MSAIDIZI_LEDGER_TEST_DATABASE_URL is required');

const parsedUrl = new URL(databaseUrl);
const expectedAck = `${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${parsedUrl.pathname.slice(1)}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('The task-event integrity test only runs against a loopback database');
}
if (!/(evidence|test)/i.test(parsedUrl.pathname.slice(1))) {
  throw new Error('The disposable database name must contain evidence or test');
}
if (databaseAck !== expectedAck) {
  throw new Error(`MSAIDIZI_LEDGER_TEST_DATABASE_ACK must equal ${expectedAck}`);
}

const clients = Array.from(
  { length: 3 },
  () => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
);
const [prisma, writerA, writerB] = clients;
const runId = randomUUID();
const principalId = `ledger-principal-${runId}`;
const taskId = `ledger-task-${runId}`;

try {
  await prisma.msaidiziPrincipal.create({
    data: {
      id: principalId,
      key: `ledger-test-${runId}`,
      displayName: 'Disposable task-event ledger test',
      grants: {},
    },
  });
  await prisma.msaidiziTask.create({
    data: {
      id: taskId,
      principalId,
      mode: 'ASK',
      title: 'Disposable task-event ledger test',
      objective: 'Verify append-only event integrity',
    },
  });

  // Deliberately submit a forged envelope through raw SQL. Prisma omits these
  // generated columns from its create input entirely; the trigger also protects
  // other SQL clients by replacing all three values.
  const [first] = await prisma.$queryRawUnsafe(
    `INSERT INTO "msaidizi_task_events" (` +
      `"taskId", "type", "actorType", "actorId", "payload", ` +
      `"integrityVersion", "previousHash", "eventHash") ` +
      `VALUES ($1, $2, $3, NULL, $4::jsonb, 999, $5, $6) RETURNING *`,
    taskId,
    'ledger.first',
    'SYSTEM',
    JSON.stringify({ runId, ordinal: 1 }),
    'f'.repeat(64),
    'e'.repeat(64),
  );
  assert.equal(first.integrityVersion, 1);
  assert.notEqual(first.previousHash, 'f'.repeat(64));
  assert.notEqual(first.eventHash, 'e'.repeat(64));

  await prisma.msaidiziTaskEvent.createMany({
    data: [2, 3, 4].map((ordinal) => ({
      taskId,
      type: 'ledger.bulk',
      actorType: 'SYSTEM',
      payload: { runId, ordinal },
    })),
  });

  // Two writers appending at once. This is the case the ledger exists to
  // survive, and for a while it did not: the cursor came from a sequence drawn
  // BEFORE the chain lock was taken, so whichever writer drew the lower number
  // but reached the lock second was rejected for an ordinary append. Both must
  // succeed, and they must land on consecutive positions.
  const concurrent = await Promise.all([
    writerA.msaidiziTaskEvent.create({
      data: {
        taskId,
        type: 'ledger.concurrent',
        actorType: 'SYSTEM',
        payload: { runId, writer: 'A' },
      },
    }),
    writerB.msaidiziTaskEvent.create({
      data: {
        taskId,
        type: 'ledger.concurrent',
        actorType: 'SYSTEM',
        payload: { runId, writer: 'B' },
      },
    }),
  ]);
  const concurrentCursors = concurrent.map((event) => BigInt(event.cursor)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.equal(concurrentCursors[1] - concurrentCursors[0], 1n);

  const brokenLinks = await prisma.$queryRaw`
    WITH ordered AS (
      SELECT
        event.*,
        lag(event."eventHash") OVER (ORDER BY event."cursor") AS expected_previous
      FROM "msaidizi_task_events" event
    )
    SELECT count(*)::INTEGER AS count
    FROM ordered
    WHERE "previousHash" <> COALESCE(expected_previous, repeat('0', 64))
       OR "eventHash" <> "msaidizi_task_event_hash_v1"(
         "previousHash",
         "cursor",
         "taskId",
         "type",
         "actorType",
         "actorId",
         "payload",
         "createdAt"
       )
  `;
  assert.deepEqual(brokenLinks, [{ count: 0 }]);

  await assert.rejects(
    prisma.msaidiziTaskEvent.update({
      where: { cursor: first.cursor },
      data: { type: 'ledger.rewritten' },
    }),
    /append-only/,
  );
  await assert.rejects(
    prisma.msaidiziTaskEvent.delete({ where: { cursor: first.cursor } }),
    /append-only/,
  );
  await assert.rejects(
    prisma.msaidiziTask.delete({ where: { id: taskId } }),
    /Foreign key constraint/,
  );
  await assert.rejects(
    // CASCADE gets past PostgreSQL's foreign-key precheck so this assertion
    // deterministically exercises the table's own append-only trigger.
    prisma.$executeRawUnsafe('TRUNCATE TABLE "msaidizi_task_events" CASCADE'),
    /append-only/,
  );
  // A supplied cursor is not honoured. It used to be REJECTED - which read as a
  // security property but was indistinguishable from the honest concurrent
  // writer above, because BIGSERIAL fires for every insert and both arrive
  // carrying a value that no longer extends the head. The ledger now allocates
  // under the same lock it reads the head with, so a chosen position is simply
  // ignored: an attempt to insert at position 1 is appended at the head, hash
  // linked, rather than either honoured or refused.
  const [beforeSupplied] = await prisma.$queryRaw`
    SELECT COALESCE(MAX("cursor"), 0)::BIGINT AS head FROM "msaidizi_task_events"
  `;
  const [suppliedCursorRow] = await prisma.$queryRawUnsafe(
    `INSERT INTO "msaidizi_task_events" (` +
      `"cursor", "taskId", "type", "actorType", "payload") ` +
      `VALUES (1, $1, 'ledger.supplied-cursor-ignored', 'SYSTEM', '{}'::jsonb) ` +
      `RETURNING "cursor", "previousHash"`,
    taskId,
  );
  assert.equal(BigInt(suppliedCursorRow.cursor), BigInt(beforeSupplied.head) + 1n);

  const runEvents = await prisma.$queryRaw`
    SELECT
      "cursor",
      "integrityVersion",
      "previousHash",
      "eventHash"
    FROM "msaidizi_task_events"
    WHERE "taskId" = ${taskId}
    ORDER BY "cursor" ASC
  `;
  // Seven, not six: the supplied-cursor insert above is now appended rather
  // than refused, so it leaves a row behind. That extra row is the point - the
  // ledger recorded the write honestly at the head instead of discarding it.
  assert.equal(runEvents.length, 7);
  // Positions are contiguous from the first event of this run, which is the
  // property the whole allocation change exists to hold under concurrency.
  const cursors = runEvents.map((event) => BigInt(event.cursor));
  cursors.forEach((cursor, index) => {
    if (index > 0) assert.equal(cursor - cursors[index - 1], 1n);
  });
  assert.ok(runEvents.every((event) => event.integrityVersion === 1));
  assert.ok(runEvents.every((event) => /^[0-9a-f]{64}$/.test(event.eventHash)));

  process.stdout.write(
    `${JSON.stringify({ passed: true, taskId, events: runEvents.length, head: runEvents.at(-1).eventHash })}\n`,
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
}
