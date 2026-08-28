import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.MSAIDIZI_PROPOSAL_USAGE_TEST_DATABASE_URL;
const databaseAck = process.env.MSAIDIZI_PROPOSAL_USAGE_TEST_DATABASE_ACK;

if (process.env.MSAIDIZI_PROPOSAL_USAGE_TEST_ALLOW_DISPOSABLE_DATABASE !== 'true') {
  throw new Error('Set MSAIDIZI_PROPOSAL_USAGE_TEST_ALLOW_DISPOSABLE_DATABASE=true explicitly');
}
if (!databaseUrl) throw new Error('MSAIDIZI_PROPOSAL_USAGE_TEST_DATABASE_URL is required');

const parsedUrl = new URL(databaseUrl);
const expectedAck = `${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${parsedUrl.pathname.slice(1)}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('The proposal-usage integrity test only runs against a loopback database');
}
if (!/(evidence|test)/i.test(parsedUrl.pathname.slice(1))) {
  throw new Error('The disposable database name must contain evidence or test');
}
if (databaseAck !== expectedAck) {
  throw new Error(`MSAIDIZI_PROPOSAL_USAGE_TEST_DATABASE_ACK must equal ${expectedAck}`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const runId = randomUUID();
const groupId = `proposal-group-${runId}`;
const companyId = `proposal-company-${runId}`;
const userId = `proposal-user-${runId}`;
const principalId = `proposal-principal-${runId}`;
const receiptId = randomUUID();
const secondReceiptId = randomUUID();
const proposalDigest = 'b'.repeat(64);

const baseReceipt = (id) => ({
  id,
  userId,
  companyId,
  mode: 'COLLABORATIVE',
  requestDigest: 'a'.repeat(64),
  model: 'disposable-integrity-model',
  inputUsdPerMillionTokens: '37.500000',
  outputUsdPerMillionTokens: '150.000000',
  status: 'RESERVED',
  reservedModelTurns: 2,
  reservedInputTokens: 400_000n,
  reservedOutputTokens: 12_000n,
  reservedCostUsd: '16.800000',
  accountedModelTurns: 2,
  accountedCostUsd: '16.800000',
  reservationExpiresAt: new Date(Date.now() + 300_000),
  expiresAt: new Date(Date.now() + 86_400_000),
});

const settlement = {
  status: 'SETTLED',
  proposalDigest,
  actualModelTurns: 1,
  inputTokens: 100n,
  cacheReadInputTokens: 20n,
  cacheCreationInputTokens: 10n,
  billedInputTokens: 130n,
  outputTokens: 50n,
  actualCostUsd: '0.012375',
  accountedModelTurns: 1,
  accountedCostUsd: '0.012375',
  settledAt: new Date(),
};

try {
  await prisma.group.create({
    data: {
      id: groupId,
      code: `PG-${runId}`,
      name: `Disposable proposal receipt group ${runId}`,
    },
  });
  await prisma.company.create({
    data: {
      id: companyId,
      groupId,
      code: `PC-${runId}`,
      name: `Disposable proposal receipt company ${runId}`,
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      companyId,
      email: `proposal-${runId}@example.invalid`,
      passwordHash: 'not-a-real-credential',
      fullName: 'Disposable proposal receipt user',
    },
  });
  await prisma.msaidiziPrincipal.create({
    data: {
      id: principalId,
      key: `proposal-integrity-${runId}`,
      displayName: 'Disposable proposal receipt principal',
      grants: {},
    },
  });

  await prisma.msaidiziProposalUsage.create({ data: baseReceipt(receiptId) });

  await assert.rejects(
    prisma.msaidiziProposalUsage.update({
      where: { id: receiptId },
      data: { failureCode: 'MUTATE_IN_PLACE' },
    }),
    /invalid msaidizi proposal usage transition from RESERVED/,
  );

  await prisma.msaidiziProposalUsage.update({
    where: { id: receiptId },
    data: settlement,
  });

  const taskId = `proposal-task-${runId}`;
  const planId = `proposal-plan-${runId}`;
  await prisma.$transaction(async (tx) => {
    await tx.msaidiziProposalUsage.update({
      where: { id: receiptId },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    await tx.msaidiziTask.create({
      data: {
        id: taskId,
        principalId,
        initiatedByUserId: userId,
        companyId,
        proposalUsageId: receiptId,
        mode: 'COLLABORATIVE',
        title: 'Disposable proposal receipt task',
        objective: 'Verify exact proposal spend attribution',
        status: 'READY',
        activePlanVersion: 1,
        modelTurns: 1,
        inputTokens: 130n,
        outputTokens: 50n,
        modelCostUsd: '0.012375',
      },
    });
    await tx.msaidiziPlanVersion.create({
      data: {
        id: planId,
        taskId,
        version: 1,
        createdByUserId: userId,
        summary: 'Disposable proposal receipt plan',
        objective: 'Verify exact proposal spend attribution',
        inputs: {},
        stopConditions: {},
        budgetSnapshot: {},
        planDigest: 'c'.repeat(64),
        sourceProposalDigest: proposalDigest,
      },
    });
    await tx.$executeRawUnsafe(
      'SET CONSTRAINTS "msaidizi_tasks_proposal_receipt_guard" IMMEDIATE',
    );
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type: 'proposal.usage.linked',
        actorType: 'SYSTEM',
        payload: { receiptId },
      },
    });
  });

  const linked = await prisma.msaidiziTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { proposalUsage: true, planVersions: true },
  });
  assert.equal(linked.proposalUsage?.status, 'CONSUMED');
  assert.equal(linked.proposalUsage?.billedInputTokens, 130n);
  assert.equal(linked.planVersions[0].sourceProposalDigest, proposalDigest);

  await assert.rejects(
    prisma.msaidiziProposalUsage.update({
      where: { id: receiptId },
      data: { failureCode: 'REWRITE_CONSUMED' },
    }),
    /terminal msaidizi proposal usage receipt cannot be changed/,
  );
  await assert.rejects(
    prisma.msaidiziProposalUsage.delete({ where: { id: receiptId } }),
    /append-preserved/,
  );
  await assert.rejects(
    // CASCADE gets past PostgreSQL's foreign-key precheck, proving the
    // append-preservation trigger itself refuses a destructive truncate.
    prisma.$executeRawUnsafe('TRUNCATE TABLE "msaidizi_proposal_usages" CASCADE'),
    /cannot be truncated/,
  );

  // The deferred guard evaluates the fully assembled transaction and rolls all
  // three writes back when the immutable plan preserves the wrong source digest.
  await prisma.msaidiziProposalUsage.create({ data: baseReceipt(secondReceiptId) });
  await prisma.msaidiziProposalUsage.update({
    where: { id: secondReceiptId },
    data: settlement,
  });
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.msaidiziProposalUsage.update({
        where: { id: secondReceiptId },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
      const badTaskId = `proposal-bad-task-${runId}`;
      await tx.msaidiziTask.create({
        data: {
          id: badTaskId,
          principalId,
          initiatedByUserId: userId,
          companyId,
          proposalUsageId: secondReceiptId,
          mode: 'COLLABORATIVE',
          title: 'Must roll back',
          objective: 'Must roll back',
          activePlanVersion: 1,
        },
      });
      await tx.msaidiziPlanVersion.create({
        data: {
          id: `proposal-bad-plan-${runId}`,
          taskId: badTaskId,
          version: 1,
          createdByUserId: userId,
          summary: 'Must roll back',
          objective: 'Must roll back',
          inputs: {},
          stopConditions: {},
          budgetSnapshot: {},
          planDigest: 'd'.repeat(64),
          sourceProposalDigest: 'e'.repeat(64),
        },
      });
      await tx.$executeRawUnsafe(
        'SET CONSTRAINTS "msaidizi_tasks_proposal_receipt_guard" IMMEDIATE',
      );
    }),
    /task proposal receipt attribution is inconsistent/,
  );
  const rolledBack = await prisma.msaidiziProposalUsage.findUniqueOrThrow({
    where: { id: secondReceiptId },
  });
  assert.equal(rolledBack.status, 'SETTLED');

  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      receiptId,
      taskId,
      state: linked.proposalUsage?.status,
      billedInputTokens: linked.proposalUsage?.billedInputTokens.toString(),
      failedAttributionRolledBack: true,
    })}\n`,
  );
} finally {
  await prisma.$disconnect();
}
