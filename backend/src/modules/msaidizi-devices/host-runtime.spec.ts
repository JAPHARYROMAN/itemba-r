import {
  BackgroundJobType,
  MsaidiziEffect,
  MsaidiziHostActionStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { JobHandlerRegistry } from '../job-worker/job-handler.registry';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziTaskStepHandler } from '../msaidizi-task-runtime/msaidizi-task-step.handler';
import { ActionResultDto } from './dto/msaidizi-device.dto';
import {
  classifyHostResult,
  constrainActionBudgetsToStep,
  heartbeatMatchesActiveActionJournal,
  heartbeatMatchesAcceptedJournal,
  heartbeatMatchesRunningTerminalJournal,
  mandateConsentGrantForAction,
  oneShotConsentGrantedForAction,
  remainingActionBudgets,
  validateActionResultOutput,
  validateJournalReceipt,
} from './msaidizi-devices.service';

describe('host runtime handoff', () => {
  it('queues once and leaves the host step RUNNING for an asynchronous result', async () => {
    const task = {
      id: 'task-1',
      status: 'RUNNING',
      mode: 'AUTOPILOT',
      activePlanVersion: 1,
      attemptedToolCalls: 0,
      maxAttemptedToolCalls: 5,
      mutations: 0,
      maxMutations: 2,
      startedAt: new Date(),
      consumedWallTimeMs: 0n,
      wallTimeCheckpointAt: new Date(),
      maxWallTimeSeconds: 7_200,
      hostExecutionAllowed: true,
      principal: { grants: [], status: 'ACTIVE' },
      mandate: { id: 'mandate-1' },
    };
    const step = {
      id: 'step-1',
      taskId: task.id,
      status: 'LEASED',
      attemptCount: 0,
      mutation: true,
      idempotent: true,
      target: 'HOST',
      capability: 'safe.example.write',
      expectedEffect: 'WRITE',
      arguments: { value: 'bounded' },
      planVersion: { version: 1 },
    };
    const prismaBase = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue(task),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziTaskStep: {
        findFirst: jest.fn().mockResolvedValue(step),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      msaidiziToolAttempt: { create: jest.fn().mockResolvedValue({}) },
      msaidiziTaskEvent: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ...prismaBase,
      $transaction: jest.fn((work: (tx: typeof prismaBase) => unknown) => work(prismaBase)),
    };
    const registry = new JobHandlerRegistry();
    const invoker = { invoke: jest.fn() };
    const devices = {
      queueHostAction: jest.fn().mockResolvedValue({
        queued: true,
        replay: false,
        actionId: 'action-1',
        deviceId: 'device-1',
      }),
    };
    const handler = new MsaidiziTaskStepHandler(
      prisma as never,
      registry,
      { enabled: true, hostExecutionEnabled: true } as never,
      { allowedTiers: ['green', 'amber', 'red'] } as never,
      new ManifestProvider(),
      invoker as never,
      { issue: jest.fn() } as never,
      { report: jest.fn().mockReturnValue({ releaseGate: { status: 'passed' } }) } as never,
      { logStrictInTransaction: jest.fn().mockResolvedValue(undefined) } as never,
      devices as never,
    );
    handler.onModuleInit();

    const run = registry.get(BackgroundJobType.MSAIDIZI_TASK_STEP)!;
    await expect(
      run({
        jobId: 'job-1',
        jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
        companyId: null,
        correlationId: task.id,
        attempts: 0,
        payload: {
          kind: 'msaidizi-task-step/v1',
          taskId: task.id,
          stepId: step.id,
          maxAttempts: 1,
        },
      }),
    ).resolves.toEqual({
      data: {
        ok: true,
        queued: true,
        replay: false,
        actionId: 'action-1',
        deviceId: 'device-1',
      },
    });
    expect(devices.queueHostAction).toHaveBeenCalledTimes(1);
    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(prisma.msaidiziTaskStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
  });

  it('classifies an uncertain mutation as UNKNOWN/NEEDS_ATTENTION without retry', () => {
    expect(
      classifyHostResult({
        outcome: 'NeedsAttention',
        mutation: true,
        mutationCommitted: false,
        outcomeUncertain: true,
        protocolInvalid: false,
      }),
    ).toMatchObject({
      needsAttention: true,
      nextAction: MsaidiziHostActionStatus.UNKNOWN,
      nextStep: 'NEEDS_ATTENTION',
      nextAttempt: 'UNKNOWN',
    });
  });

  it('mints emergency operator consent only from the exact activated mandate grant', () => {
    const mandate = {
      capabilities: [
        {
          capability: 'filesystem.delete.permanent',
          version: '1.0.0',
          effects: [MsaidiziEffect.IRREVERSIBLE],
          dataClasses: ['restricted'],
          consentGrants: ['emergency_operator'],
        },
      ],
    } as never;
    expect(
      mandateConsentGrantForAction(
        mandate,
        'filesystem.delete.permanent',
        '1.0.0',
        MsaidiziEffect.IRREVERSIBLE,
        'restricted',
        'EmergencyOperator',
      ),
    ).toBe('emergency_operator');
    expect(
      mandateConsentGrantForAction(
        mandate,
        'filesystem.delete.permanent',
        '1.0.0',
        MsaidiziEffect.IRREVERSIBLE,
        'confidential',
        'EmergencyOperator',
      ),
    ).toBeNull();
    expect(
      mandateConsentGrantForAction(
        mandate,
        'filesystem.delete.permanent',
        '1.0.0',
        MsaidiziEffect.IRREVERSIBLE,
        'restricted',
        'ActiveUser',
      ),
    ).toBeNull();
  });

  it.each(['speech.audio.transcribe', 'command.privileged.execute'])(
    'mints one-shot consent for %s only from the initiating human and exact action binding',
    (capability) => {
      const action = {
        stepId: 'step-1',
        argsDigest: 'a'.repeat(64),
        capability,
        capabilityVersion: '1.0.0',
        step: { planVersionId: 'plan-1' },
      };
      const event = {
        actorType: 'HUMAN',
        actorId: 'operator-1',
        payload: {
          protocol: 'msaidizi-one-shot-step-consent/v1',
          planVersionId: 'plan-1',
          stepId: 'step-1',
          capability,
          capabilityVersion: '1.0.0',
          argumentsSha256: 'a'.repeat(64),
          consentGrant: 'one_shot_approval',
          instructionAuthority: 'NONE',
        },
      } as const;

      expect(oneShotConsentGrantedForAction([event], 'operator-1', action)).toBe(true);
      expect(
        oneShotConsentGrantedForAction([{ ...event, actorId: 'other-user' }], 'operator-1', action),
      ).toBe(false);
      expect(
        oneShotConsentGrantedForAction(
          [{ ...event, payload: { ...event.payload, stepId: 'other-step' } }],
          'operator-1',
          action,
        ),
      ).toBe(false);
      expect(
        oneShotConsentGrantedForAction(
          [{ ...event, payload: { ...event.payload, argumentsSha256: 'b'.repeat(64) } }],
          'operator-1',
          action,
        ),
      ).toBe(false);
      expect(
        mandateConsentGrantForAction(
          null,
          action.capability,
          action.capabilityVersion,
          MsaidiziEffect.READ,
          'Biometric',
          'OneShotApproval',
          true,
        ),
      ).toBe('one_shot_approval');
      expect(
        mandateConsentGrantForAction(
          null,
          action.capability,
          action.capabilityVersion,
          MsaidiziEffect.READ,
          'Biometric',
          'OneShotApproval',
          false,
        ),
      ).toBeNull();
    },
  );

  it('does not widen one-shot consent evidence to unregistered capabilities', () => {
    const action = {
      stepId: 'step-1',
      argsDigest: 'a'.repeat(64),
      capability: 'filesystem.entry.write',
      capabilityVersion: '1.0.0',
      step: { planVersionId: 'plan-1' },
    };
    const event = {
      actorType: 'HUMAN',
      actorId: 'operator-1',
      payload: {
        protocol: 'msaidizi-one-shot-step-consent/v1',
        planVersionId: 'plan-1',
        stepId: 'step-1',
        capability: action.capability,
        capabilityVersion: action.capabilityVersion,
        argumentsSha256: action.argsDigest,
        consentGrant: 'one_shot_approval',
        instructionAuthority: 'NONE',
      },
    };

    expect(oneShotConsentGrantedForAction([event], 'operator-1', action)).toBe(false);
  });

  it('requires and reconciles pre-action head → prepared → terminal journal links', () => {
    const baseHash = 'a'.repeat(64);
    const prepareHash = 'b'.repeat(64);
    const entryHash = 'c'.repeat(64);
    const receipt = {
      journalPrepareSequence: 12,
      journalPrepareEntryHash: prepareHash,
      journalPreparePreviousHash: baseHash,
      journalSequence: 13,
      journalEntryHash: entryHash,
      journalPreviousHash: prepareHash,
    } as ActionResultDto;

    expect(
      validateJournalReceipt(receipt, 'Completed', {
        journalSequence: 11,
        journalHeadHash: baseHash,
      }),
    ).toEqual({ valid: true, reconciliation: 'PREPARE_PREDECESSOR_CONFIRMED' });
    expect(
      validateJournalReceipt({ ...receipt, journalPreviousHash: undefined }, 'Completed', null),
    ).toEqual({ valid: false, reconciliation: 'INCOMPLETE' });
    expect(
      validateJournalReceipt(receipt, 'Completed', {
        journalSequence: 12,
        journalHeadHash: 'd'.repeat(64),
      }),
    ).toEqual({ valid: false, reconciliation: 'PREPARE_MISMATCH' });
    expect(
      validateJournalReceipt(receipt, 'Completed', {
        journalSequence: 14,
        journalHeadHash: 'd'.repeat(64),
      }),
    ).toEqual({ valid: false, reconciliation: 'LATER_HEAD_UNPROVEN' });
    expect(
      validateJournalReceipt(
        receipt,
        'Completed',
        { journalSequence: 11, journalHeadHash: baseHash },
        'e'.repeat(64),
      ),
    ).toEqual({ valid: false, reconciliation: 'INVALID' });
    expect(
      validateJournalReceipt(
        { ...receipt, journalPreviousHash: 'f'.repeat(64) },
        'Completed',
        { journalSequence: 11, journalHeadHash: baseHash },
        baseHash,
      ),
    ).toEqual({ valid: false, reconciliation: 'INVALID' });
  });

  it('requires and reconciles prepared → recovery-prepared → terminal journal links', () => {
    const baseHash = 'a'.repeat(64);
    const prepareHash = 'b'.repeat(64);
    const recoveryPreparedHash = 'c'.repeat(64);
    const terminalHash = 'd'.repeat(64);
    const receipt = {
      journalPrepareSequence: 12,
      journalPrepareEntryHash: prepareHash,
      journalPreparePreviousHash: baseHash,
      journalRecoveryPreparedSequence: 13,
      journalRecoveryPreparedEntryHash: recoveryPreparedHash,
      journalRecoveryPreparedPreviousHash: prepareHash,
      journalSequence: 14,
      journalEntryHash: terminalHash,
      journalPreviousHash: recoveryPreparedHash,
    } as ActionResultDto;

    expect(
      validateJournalReceipt(receipt, 'NeedsAttention', {
        journalSequence: 13,
        journalHeadHash: recoveryPreparedHash,
      }),
    ).toEqual({ valid: true, reconciliation: 'RECOVERY_PREPARE_CONFIRMED' });
    expect(
      validateJournalReceipt(receipt, 'NeedsAttention', {
        journalSequence: 14,
        journalHeadHash: terminalHash,
      }),
    ).toEqual({ valid: true, reconciliation: 'ENTRY_CONFIRMED' });
    expect(
      validateJournalReceipt(
        { ...receipt, journalRecoveryPreparedEntryHash: undefined },
        'NeedsAttention',
        { journalSequence: 14, journalHeadHash: terminalHash },
      ),
    ).toEqual({ valid: false, reconciliation: 'INCOMPLETE' });
    expect(
      validateJournalReceipt(
        { ...receipt, journalRecoveryPreparedPreviousHash: 'e'.repeat(64) },
        'NeedsAttention',
        { journalSequence: 14, journalHeadHash: terminalHash },
      ),
    ).toEqual({ valid: false, reconciliation: 'INVALID' });
    expect(
      validateJournalReceipt({ ...receipt, journalPreviousHash: prepareHash }, 'NeedsAttention', {
        journalSequence: 14,
        journalHeadHash: terminalHash,
      }),
    ).toEqual({ valid: false, reconciliation: 'INVALID' });
    expect(
      validateJournalReceipt(
        {
          ...receipt,
          journalRecoveryPreparedEntryHash: baseHash,
          journalPreviousHash: baseHash,
          journalEntryHash: prepareHash,
        },
        'NeedsAttention',
        { journalSequence: 14, journalHeadHash: prepareHash },
      ),
    ).toEqual({ valid: false, reconciliation: 'INVALID' });
  });

  it('signs each host action with only the task budgets still remaining', () => {
    const remaining = remainingActionBudgets({
      maxWallTimeSeconds: 7_200,
      maxModelTurns: 200,
      maxAttemptedToolCalls: 500,
      maxMutations: 100,
      maxLocalBytes: 100n,
      maxExternalEgressBytes: 8_000_000n,
      maxModelCostUsd: new Prisma.Decimal(20),
      consumedWallTimeMs: 5_000n,
      wallTimeCheckpointAt: new Date(),
      modelTurns: 2,
      attemptedToolCalls: 4,
      mutations: 1,
      bytesRead: 40n,
      bytesWritten: 10n,
      externalEgressBytes: 3_000_000n,
      reservedExternalEgressBytes: 1_000_000n,
      modelCostUsd: new Prisma.Decimal(3.5),
    });

    expect(remaining).toMatchObject({
      maxLocalBytes: 50,
      maxExternalEgressBytes: 4_000_000,
      maxModelSpendUsd: 16.5,
    });
    expect(remaining!.maxWallTimeSeconds).toBeLessThanOrEqual(7_195);
  });

  it('fails host authorization closed when persisted wall-time accounting is corrupt', () => {
    expect(
      remainingActionBudgets({
        maxWallTimeSeconds: 7_200,
        maxModelTurns: 200,
        maxAttemptedToolCalls: 500,
        maxMutations: 100,
        maxLocalBytes: 100n,
        maxExternalEgressBytes: 1_000_000n,
        maxModelCostUsd: new Prisma.Decimal(20),
        consumedWallTimeMs: -1n,
        wallTimeCheckpointAt: new Date(),
        modelTurns: 0,
        attemptedToolCalls: 0,
        mutations: 0,
        bytesRead: 0n,
        bytesWritten: 0n,
        externalEgressBytes: 0n,
        reservedExternalEgressBytes: 0n,
        modelCostUsd: new Prisma.Decimal(0),
      }),
    ).toBeNull();
  });

  it('further constrains the signed host contract to immutable step I/O and egress ceilings', () => {
    const constrained = constrainActionBudgetsToStep(
      {
        maxWallTimeSeconds: 7_000,
        maxModelTurns: 190,
        maxAttemptedToolCalls: 490,
        maxMutations: 99,
        maxLocalBytes: 5_000_000,
        maxExternalEgressBytes: 8_000_000,
        maxModelSpendUsd: 18,
        brokerMaxDeliverySessions: 3,
        brokerMaxRequestAttemptsPerSession: 3,
        brokerSerializedResultUpperBoundBytes: 222_222,
      },
      {
        budgets: {
          maxWallTimeSeconds: 60,
          maxLocalBytes: 30_000,
          maxExternalEgressBytes: 3_000_000,
        },
        startedAt: new Date(),
      },
    );

    expect(constrained).toMatchObject({
      maxWallTimeSeconds: 60,
      maxLocalBytes: 30_000,
      maxExternalEgressBytes: 3_000_000,
    });
    expect(constrained!.brokerSerializedResultUpperBoundBytes).toBeLessThanOrEqual(83_333);
  });

  it('meters capability, prepaid broker, and uncertainty egress without adding output twice', () => {
    const outputJson = JSON.stringify({ ok: true });
    const dto = {
      actionId: 'action-1',
      actionTokenSha256: 'd'.repeat(64),
      taskId: 'task-1',
      stepId: 'step-1',
      leaseId: 'lease-1',
      fencingToken: '7',
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      outcome: 'Completed',
      outputJson,
      outputSha256: createHash('sha256').update(outputJson).digest('hex'),
      mutationCommitted: false,
      outcomeUncertain: false,
      isIdempotentReplay: false,
      errorCode: null,
      provenance: [],
      localBytesRead: 0,
      localBytesWritten: 0,
      externalEgressBytes: 17,
      brokerExternalEgressBytes: 589_824,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 65_536,
      uncertainExternalEgressBytes: 3,
    } as ActionResultDto;
    const outputBytes = BigInt(Buffer.byteLength(outputJson, 'utf8'));

    expect(validateActionResultOutput(dto, 589_844n)).toMatchObject({
      valid: true,
      outputBytes,
      capabilityExternalEgressBytes: 17n,
      brokerExternalEgressBytes: 589_824n,
      uncertainExternalEgressBytes: 3n,
      totalExternalEgressBytes: 589_844n,
    });
    expect(validateActionResultOutput(dto, 589_843n).valid).toBe(false);
    expect(validateActionResultOutput({ ...dto, externalEgressBytes: -1 }, 589_844n).valid).toBe(
      false,
    );
    expect(
      validateActionResultOutput({ ...dto, brokerExternalEgressBytes: 589_825 }, 589_845n).valid,
    ).toBe(false);
  });

  it('accepts only a heartbeat position proven by the last accepted terminal journal', () => {
    const accepted = {
      journalPrepareSequence: 12,
      journalPreparePreviousHash: 'a'.repeat(64),
      journalPrepareHash: 'b'.repeat(64),
      journalSequence: 13,
      journalHash: 'c'.repeat(64),
    };
    expect(heartbeatMatchesAcceptedJournal(11, 'a'.repeat(64), accepted)).toBe(false);
    expect(heartbeatMatchesAcceptedJournal(12, 'b'.repeat(64), accepted)).toBe(false);
    expect(heartbeatMatchesAcceptedJournal(13, 'c'.repeat(64), accepted)).toBe(true);
    expect(heartbeatMatchesAcceptedJournal(14, 'd'.repeat(64), accepted)).toBe(false);
    expect(heartbeatMatchesAcceptedJournal(10, 'e'.repeat(64), accepted)).toBe(false);
    expect(heartbeatMatchesActiveActionJournal(13, 'c'.repeat(64), 13, 'c'.repeat(64))).toBe(true);
    expect(heartbeatMatchesActiveActionJournal(14, 'd'.repeat(64), 13, 'c'.repeat(64))).toBe(true);
    expect(heartbeatMatchesActiveActionJournal(15, 'e'.repeat(64), 13, 'c'.repeat(64))).toBe(true);
    expect(heartbeatMatchesActiveActionJournal(16, 'f'.repeat(64), 13, 'c'.repeat(64))).toBe(true);
    expect(heartbeatMatchesActiveActionJournal(17, 'a'.repeat(64), 13, 'c'.repeat(64))).toBe(false);
    expect(heartbeatMatchesRunningTerminalJournal(15, 'e'.repeat(64), 13, 'c'.repeat(64))).toBe(
      true,
    );
    expect(heartbeatMatchesRunningTerminalJournal(14, 'd'.repeat(64), 13, 'c'.repeat(64))).toBe(
      false,
    );
    expect(heartbeatMatchesRunningTerminalJournal(16, 'f'.repeat(64), 13, 'c'.repeat(64))).toBe(
      true,
    );
    expect(
      heartbeatMatchesRunningTerminalJournal(
        15,
        'e'.repeat(64),
        13,
        'c'.repeat(64),
        15,
        'f'.repeat(64),
      ),
    ).toBe(false);
    expect(
      heartbeatMatchesRunningTerminalJournal(
        15,
        'e'.repeat(64),
        13,
        'c'.repeat(64),
        15,
        'e'.repeat(64),
      ),
    ).toBe(true);
    expect(
      heartbeatMatchesRunningTerminalJournal(
        16,
        'f'.repeat(64),
        13,
        'c'.repeat(64),
        15,
        'e'.repeat(64),
      ),
    ).toBe(true);
    expect(
      heartbeatMatchesRunningTerminalJournal(
        15,
        'e'.repeat(64),
        13,
        'c'.repeat(64),
        16,
        'f'.repeat(64),
      ),
    ).toBe(false);
    expect(
      heartbeatMatchesRunningTerminalJournal(
        17,
        'a'.repeat(64),
        13,
        'c'.repeat(64),
        15,
        'e'.repeat(64),
      ),
    ).toBe(false);
  });

  it('accepts digest-only output only for the matching known terminal replay', () => {
    const expected = 'a'.repeat(64);
    const replay = {
      actionId: 'action-1',
      actionTokenSha256: 'd'.repeat(64),
      taskId: 'task-1',
      stepId: 'step-1',
      leaseId: 'lease-1',
      fencingToken: '7',
      leaseExpiresAt: '2099-01-01T00:00:00.000Z',
      outcome: 'Completed',
      outputJson: null,
      outputSha256: expected,
      mutationCommitted: false,
      outcomeUncertain: false,
      isIdempotentReplay: true,
      errorCode: null,
      provenance: [],
      localBytesRead: 0,
      localBytesWritten: 0,
      externalEgressBytes: 0,
      brokerExternalEgressBytes: 589_824,
      brokerMaxDeliverySessions: 3,
      brokerMaxRequestAttemptsPerSession: 3,
      brokerSerializedResultUpperBoundBytes: 65_536,
      uncertainExternalEgressBytes: 0,
    } as ActionResultDto;

    expect(validateActionResultOutput(replay, 589_824n).valid).toBe(false);
    expect(
      validateActionResultOutput(replay, 589_824n, { expectedOutputSha256: expected }).valid,
    ).toBe(true);
    expect(
      validateActionResultOutput(replay, 589_824n, {
        expectedOutputSha256: 'b'.repeat(64),
      }).valid,
    ).toBe(false);
    expect(
      validateActionResultOutput({ ...replay, isIdempotentReplay: false }, 589_824n, {
        expectedOutputSha256: expected,
      }).valid,
    ).toBe(false);
  });

  it.each(['Rejected', 'Cancelled', 'Failed', 'NeedsAttention', 'Completed'])(
    'requires a complete journal receipt for terminal outcome %s',
    (outcome) => {
      expect(validateJournalReceipt({} as ActionResultDto, outcome, null)).toEqual({
        valid: false,
        reconciliation: 'MISSING',
      });
    },
  );
});
