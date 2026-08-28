import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.MSAIDIZI_PLAN_IMMUTABILITY_TEST_DATABASE_URL;
const databaseAck = process.env.MSAIDIZI_PLAN_IMMUTABILITY_TEST_DATABASE_ACK;

if (process.env.MSAIDIZI_PLAN_IMMUTABILITY_TEST_ALLOW_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Set MSAIDIZI_PLAN_IMMUTABILITY_TEST_ALLOW_DISPOSABLE_DATABASE=true explicitly');
}
if (!databaseUrl) throw new Error('MSAIDIZI_PLAN_IMMUTABILITY_TEST_DATABASE_URL is required');

const parsedUrl = new URL(databaseUrl);
const expectedAck = `${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${parsedUrl.pathname.slice(1)}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('The plan-immutability test only runs against a loopback database');
}
if (!/(evidence|test)/i.test(parsedUrl.pathname.slice(1))) {
  throw new Error('The disposable database name must contain evidence or test');
}
if (databaseAck !== expectedAck) {
  throw new Error(`MSAIDIZI_PLAN_IMMUTABILITY_TEST_DATABASE_ACK must equal ${expectedAck}`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const runId = randomUUID();
const principalId = `plan-immutability-principal-${runId}`;
const taskId = `plan-immutability-task-${runId}`;
const planId = `plan-immutability-plan-${runId}`;
const stepId = `plan-immutability-step-${runId}`;

try {
  await prisma.msaidiziPrincipal.create({
    data: {
      id: principalId,
      key: `plan-immutability-${runId}`,
      displayName: 'Disposable plan immutability principal',
      grants: {},
    },
  });
  await prisma.msaidiziTask.create({
    data: {
      id: taskId,
      principalId,
      mode: 'ASK',
      title: 'Disposable immutable plan',
      objective: 'Prove plan definitions cannot be rewritten',
      status: 'READY',
      activePlanVersion: 1,
    },
  });
  await prisma.msaidiziPlanVersion.create({
    data: {
      id: planId,
      taskId,
      version: 1,
      summary: 'Immutable plan summary',
      objective: 'Prove plan definitions cannot be rewritten',
      inputs: { source: 'disposable-regression' },
      stopConditions: { onFailure: true },
      budgetSnapshot: { maxAttemptedToolCalls: 1 },
      planDigest: 'a'.repeat(64),
    },
  });
  await prisma.msaidiziTaskStep.create({
    data: {
      id: stepId,
      taskId,
      planVersionId: planId,
      stepKey: 'immutable-step',
      sequence: 1,
      name: 'Read one governed resource',
      target: 'ERP',
      capability: 'CustomersController.findAll',
      capabilityVersion: '1',
      arguments: { query: { page: 1, limit: 1 } },
      dependencies: [],
      expectedEffect: 'READ',
      dataClass: 'INTERNAL',
      preconditions: [],
      recovery: null,
      budgets: { maxAttemptedToolCalls: 1 },
      stopConditions: { onFailure: true },
      idempotent: true,
      mutation: false,
    },
  });

  await assert.rejects(
    prisma.msaidiziPlanVersion.update({
      where: { id: planId },
      data: { summary: 'Rewritten after review' },
    }),
    /plan versions are immutable/,
  );
  await assert.rejects(
    prisma.msaidiziPlanVersion.delete({ where: { id: planId } }),
    /append-preserved/,
  );
  await assert.rejects(
    prisma.msaidiziTaskStep.update({
      where: { id: stepId },
      data: { capability: 'ExpensesController.create' },
    }),
    /task-step definitions are immutable/,
  );
  await assert.rejects(
    prisma.msaidiziTaskStep.update({
      where: { id: stepId },
      data: { arguments: { body: { amount: 999999 } } },
    }),
    /task-step definitions are immutable/,
  );
  await assert.rejects(
    prisma.msaidiziTaskStep.update({
      where: { id: stepId },
      data: { localIoAccountingValid: false },
    }),
    /task-step definitions are immutable/,
  );

  await assert.rejects(
    prisma.msaidiziTask.update({
      where: { id: taskId },
      data: { maxWallTimeSeconds: { increment: 1 } },
    }),
    /task runtime ceilings are immutable/,
  );

  const taskStartedAt = new Date();
  const runningTask = await prisma.msaidiziTask.update({
    where: { id: taskId },
    data: { status: 'RUNNING', startedAt: taskStartedAt },
  });
  assert.equal(runningTask.startedAt?.getTime(), taskStartedAt.getTime());
  await assert.rejects(
    prisma.msaidiziTask.update({
      where: { id: taskId },
      data: { startedAt: new Date(taskStartedAt.getTime() + 1_000) },
    }),
    /task first-start timestamp is immutable/,
  );

  const stepStartedAt = new Date();
  const running = await prisma.msaidiziTaskStep.update({
    where: { id: stepId },
    data: {
      status: 'RUNNING',
      attemptCount: { increment: 1 },
      bytesRead: { increment: 64n },
      bytesWritten: { increment: 32n },
      startedAt: stepStartedAt,
      checkpointedAt: new Date(),
    },
  });
  assert.equal(running.status, 'RUNNING');
  assert.equal(running.attemptCount, 1);
  assert.equal(running.bytesRead, 64n);
  assert.equal(running.bytesWritten, 32n);
  assert.equal(running.startedAt?.getTime(), stepStartedAt.getTime());
  await assert.rejects(
    prisma.msaidiziTaskStep.update({
      where: { id: stepId },
      data: { startedAt: new Date(stepStartedAt.getTime() + 1_000) },
    }),
    /task-step first-start timestamp is immutable/,
  );

  await assert.rejects(
    prisma.msaidiziTaskStep.delete({ where: { id: stepId } }),
    /append-preserved/,
  );
  await assert.rejects(
    prisma.msaidiziTask.delete({ where: { id: taskId } }),
    /(append-preserved|plan versions)/,
  );

  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      taskId,
      planId,
      stepId,
      runtimeStateUpdateAllowed: true,
      taskRuntimeCeilingRewriteRejected: true,
      taskFirstStartRewriteRejected: true,
      stepFirstStartRewriteRejected: true,
      definitionRewriteRejected: true,
    })}\n`,
  );
} finally {
  await prisma.$disconnect();
}
