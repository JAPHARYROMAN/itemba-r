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

  await Promise.all([
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
  await assert.rejects(
    prisma.$executeRawUnsafe(
      `INSERT INTO "msaidizi_task_events" (` +
        `"cursor", "taskId", "type", "actorType", "payload") ` +
        `VALUES (1, $1, 'ledger.out-of-order', 'SYSTEM', '{}'::jsonb)`,
      taskId,
    ),
    /does not extend chain head/,
  );

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
  assert.equal(runEvents.length, 6);
  assert.ok(runEvents.every((event) => event.integrityVersion === 1));
  assert.ok(runEvents.every((event) => /^[0-9a-f]{64}$/.test(event.eventHash)));

  process.stdout.write(
    `${JSON.stringify({ passed: true, taskId, events: runEvents.length, head: runEvents.at(-1).eventHash })}\n`,
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
}
