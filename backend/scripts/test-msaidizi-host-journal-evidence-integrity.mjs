import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;
const databaseAck = process.env.MSAIDIZI_HOST_JOURNAL_EVIDENCE_TEST_DATABASE_ACK;

if (process.env.MSAIDIZI_HOST_JOURNAL_EVIDENCE_TEST_ALLOW_DISPOSABLE_DATABASE !== 'true') {
  throw new Error(
    'Set MSAIDIZI_HOST_JOURNAL_EVIDENCE_TEST_ALLOW_DISPOSABLE_DATABASE=true explicitly',
  );
}
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const parsedUrl = new URL(databaseUrl);
const expectedAck = `${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${parsedUrl.pathname.slice(1)}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)) {
  throw new Error('The host-journal evidence integrity test only runs against a loopback database');
}
if (!/(evidence|test)/i.test(parsedUrl.pathname.slice(1))) {
  throw new Error('The disposable database name must contain evidence or test');
}
if (databaseAck !== expectedAck) {
  throw new Error(`MSAIDIZI_HOST_JOURNAL_EVIDENCE_TEST_DATABASE_ACK must equal ${expectedAck}`);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const runId = randomUUID();
const principalId = `journal-evidence-principal-${runId}`;
const taskId = `journal-evidence-task-${runId}`;
const planId = `journal-evidence-plan-${runId}`;
const stepId = `journal-evidence-step-${runId}`;
const deviceId = `journal-evidence-device-${runId}`;
const hostActionId = `journal-evidence-action-${runId}`;
const acceptedAt = new Date();

const hashes = {
  preparePrevious: '1'.repeat(64),
  prepare: '2'.repeat(64),
  recoveryPrepared: '3'.repeat(64),
  terminal: '4'.repeat(64),
  receipt: '5'.repeat(64),
};

class IntentionalRollback extends Error {}

const rollbackSignal = new IntentionalRollback('rollback disposable journal-evidence fixture');
const rejectedChecks = [];

function errorDetails(error) {
  return [error?.message, error?.meta?.database_error, error?.meta?.constraint]
    .filter(Boolean)
    .join('\n');
}

async function expectConstraintFailure(tx, label, constraintName, operation) {
  const savepoint = `journal_evidence_${rejectedChecks.length + 1}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);

  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }

  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);

  if (!failure) {
    assert.fail(`${label} unexpectedly passed its database constraint`);
  }
  assert.match(errorDetails(failure), new RegExp(constraintName));
  rejectedChecks.push(label);
}

try {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.msaidiziPrincipal.create({
          data: {
            id: principalId,
            key: `journal-evidence-${runId}`,
            displayName: 'Disposable host-journal evidence principal',
            grants: {},
          },
        });
        await tx.msaidiziTask.create({
          data: {
            id: taskId,
            principalId,
            mode: 'AUTOPILOT',
            title: 'Disposable host-journal evidence task',
            objective: 'Verify database-bound RecoveryPrepared evidence constraints',
            status: 'READY',
            activePlanVersion: 1,
          },
        });
        await tx.msaidiziPlanVersion.create({
          data: {
            id: planId,
            taskId,
            version: 1,
            summary: 'Exercise host-journal evidence constraints',
            objective: 'Verify database-bound RecoveryPrepared evidence constraints',
            inputs: {},
            stopConditions: {},
            budgetSnapshot: {},
            planDigest: 'a'.repeat(64),
          },
        });
        await tx.msaidiziTaskStep.create({
          data: {
            id: stepId,
            taskId,
            planVersionId: planId,
            stepKey: 'host-journal-evidence',
            sequence: 1,
            name: 'Verify host-journal evidence',
            target: 'HOST',
            capability: 'test.host.journal-evidence',
            capabilityVersion: '1',
            arguments: {},
            dependencies: [],
            expectedEffect: 'WRITE',
            dataClass: 'INTERNAL',
            preconditions: [],
            recovery: {},
            budgets: {},
            stopConditions: {},
            idempotent: true,
            mutation: true,
          },
        });
        await tx.msaidiziDevice.create({
          data: {
            id: deviceId,
            principalId,
            name: 'Disposable host-journal evidence device',
            status: 'ACTIVE',
            publicKey: 'disposable-test-key',
            capabilityManifest: {},
          },
        });
        const evidenceEvent = await tx.msaidiziTaskEvent.create({
          data: {
            taskId,
            type: 'host_action.late_evidence_reconciled',
            actorType: 'DEVICE_BROKER',
            actorId: deviceId,
            payload: { fixture: true },
          },
        });
        const evidenceEventCursor = evidenceEvent.cursor;
        await tx.msaidiziHostAction.create({
          data: {
            id: hostActionId,
            taskId,
            stepId,
            deviceId,
            actionId: `journal-evidence-action-id-${runId}`,
            capability: 'test.host.journal-evidence',
            capabilityVersion: '1',
            argumentsRedacted: {},
            argsDigest: '6'.repeat(64),
            actionTokenDigest: '7'.repeat(64),
            idempotencyKey: `journal-evidence-idempotency-${runId}`,
            expectedPreState: {},
            budgetSnapshot: {},
            dataClass: 'INTERNAL',
            effect: 'WRITE',
            consent: 'TEST_ONLY',
            recovery: 'RECOVERY_PREPARED',
          },
        });

        const valid = await tx.msaidiziHostAction.update({
          where: { id: hostActionId },
          data: {
            journalPrepareSequence: 40,
            journalPreparePreviousHash: hashes.preparePrevious,
            journalPrepareHash: hashes.prepare,
            journalRecoveryPreparedSequence: 41,
            journalRecoveryPreparedPreviousHash: hashes.prepare,
            journalRecoveryPreparedHash: hashes.recoveryPrepared,
            journalSequence: 42,
            journalPreviousHash: hashes.recoveryPrepared,
            journalHash: hashes.terminal,
            journalReceiptDigest: hashes.receipt,
            journalEvidenceEventCursor: evidenceEventCursor,
            journalEvidenceAcceptedAt: acceptedAt,
            lateEvidenceAcceptedAt: acceptedAt,
          },
        });
        assert.equal(valid.journalRecoveryPreparedSequence, 41);
        assert.equal(valid.journalSequence, 42);
        assert.equal(valid.journalReceiptDigest, hashes.receipt);
        assert.equal(valid.journalEvidenceEventCursor, evidenceEventCursor);
        assert.equal(valid.lateEvidenceAcceptedAt?.getTime(), acceptedAt.getTime());

        await expectConstraintFailure(
          tx,
          'partial RecoveryPrepared checkpoint',
          'msaidizi_host_actions_recovery_checkpoint_complete_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalRecoveryPreparedHash" = NULL WHERE "id" = $1',
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'partial evidence envelope',
          'msaidizi_host_actions_journal_evidence_complete_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalEvidenceAcceptedAt" = NULL WHERE "id" = $1',
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'nonexistent immutable evidence event',
          'msaidizi_host_actions_journalEvidenceEventCursor_fkey',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalEvidenceEventCursor" = $1 WHERE "id" = $2',
              9_000_000_000_000_000_000n,
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'noncontiguous RecoveryPrepared sequence',
          'msaidizi_host_actions_recovery_checkpoint_chain_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalRecoveryPreparedSequence" = 43 WHERE "id" = $1',
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'broken RecoveryPrepared hash link',
          'msaidizi_host_actions_recovery_checkpoint_chain_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalRecoveryPreparedPreviousHash" = $1 WHERE "id" = $2',
              '8'.repeat(64),
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'reused journal chain head',
          'msaidizi_host_actions_recovery_checkpoint_chain_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalHash" = "journalPrepareHash" WHERE "id" = $1',
              hostActionId,
            ),
        );
        await expectConstraintFailure(
          tx,
          'late acceptance without evidence',
          'msaidizi_host_actions_late_evidence_check',
          () =>
            tx.$executeRawUnsafe(
              'UPDATE "msaidizi_host_actions" SET "journalReceiptDigest" = NULL, "journalEvidenceEventCursor" = NULL, "journalEvidenceAcceptedAt" = NULL, "lateEvidenceAcceptedAt" = NOW() WHERE "id" = $1',
              hostActionId,
            ),
        );

        throw rollbackSignal;
      },
      { timeout: 30_000 },
    );
    assert.fail('The disposable fixture transaction unexpectedly committed');
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  assert.equal(
    await prisma.msaidiziHostAction.count({ where: { id: hostActionId } }),
    0,
    'the host-action fixture must be rolled back',
  );
  assert.equal(
    await prisma.msaidiziPrincipal.count({ where: { id: principalId } }),
    0,
    'the fixture graph must be rolled back',
  );

  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      validCompleteEnvelopeAccepted: true,
      rejectedChecks,
      transactionRolledBack: true,
    })}\n`,
  );
} finally {
  await prisma.$disconnect();
}
