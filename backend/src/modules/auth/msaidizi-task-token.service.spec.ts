import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { exactActionEnvelopeDigest } from '../../common/utils/action-envelope';
import { MsaidiziTaskTokenService } from './msaidizi-task-token.service';

function config(values: Record<string, string>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('MsaidiziTaskTokenService', () => {
  it('fails closed before touching storage while autonomy is disabled', async () => {
    const prisma = { msaidiziTask: { findUnique: jest.fn() } };
    const service = new MsaidiziTaskTokenService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      config({ MSAIDIZI_AUTONOMY_ENABLED: 'false' }),
    );

    await expect(service.issue({ taskId: 'task-1', stepId: 'step-1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.msaidiziTask.findUnique).not.toHaveBeenCalled();
  });

  it('mints a short-lived token bound to principal, task, plan, step, capability and args', async () => {
    const signAsync = jest.fn().mockResolvedValue('signed-task-token');
    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'task-1',
          status: 'RUNNING',
          mode: 'COLLABORATIVE',
          principalId: 'principal-1',
          initiatedByUserId: 'user-1',
          mandateId: null,
          activePlanVersion: 2,
          principal: { status: 'ACTIVE', createdByUserId: 'user-1' },
          mandate: null,
          steps: [
            {
              id: 'step-1',
              status: 'RUNNING',
              planVersionId: 'plan-2',
              capability: 'CustomersController.findOne',
              arguments: { path: { id: 41 }, query: {} },
            },
          ],
        }),
      },
      msaidiziPlanVersion: {
        findUnique: jest.fn().mockResolvedValue({ version: 2 }),
      },
      msaidiziToolAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          argsDigest: exactActionEnvelopeDigest({ path: { id: 41 }, query: {} }),
          resolvedInputProvenance: null,
          inputProvenanceSha256: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MsaidiziTaskTokenService(
      prisma as never,
      { signAsync } as never,
      config({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
        MSAIDIZI_TASK_TOKEN_TTL_SECONDS: '9999',
      }),
    );

    const issued = await service.issue({ taskId: 'task-1', stepId: 'step-1' });

    expect(issued).toEqual({
      accessToken: 'signed-task-token',
      expiresInSeconds: 300,
      argsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenUse: 'msaidizi-task',
        jti: expect.any(String),
        sub: 'user-1',
        principalId: 'principal-1',
        taskId: 'task-1',
        planVersion: 2,
        stepId: 'step-1',
        capability: 'CustomersController.findOne',
        argsDigest: issued.argsDigest,
      }),
      { expiresIn: 300 },
    );
    expect(prisma.msaidiziToolAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'attempt-1',
          credentialJtiDigest: null,
        }),
        data: { credentialJtiDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }),
    );
  });

  it('fails closed when the task initiator was deleted instead of borrowing the principal creator', async () => {
    const signAsync = jest.fn();
    const attemptFindFirst = jest.fn();
    const prisma = {
      msaidiziTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'task-1',
          status: 'RUNNING',
          mode: 'COLLABORATIVE',
          principalId: 'principal-1',
          initiatedByUserId: null,
          mandateId: null,
          activePlanVersion: 1,
          principal: { status: 'ACTIVE', createdByUserId: 'principal-creator' },
          mandate: null,
          steps: [
            {
              id: 'step-1',
              status: 'RUNNING',
              planVersionId: 'plan-1',
              capability: 'CustomersController.findOne',
              arguments: { path: { id: 41 }, query: {} },
            },
          ],
        }),
      },
      msaidiziPlanVersion: { findUnique: jest.fn().mockResolvedValue({ version: 1 }) },
      msaidiziToolAttempt: { findFirst: attemptFindFirst },
    };
    const service = new MsaidiziTaskTokenService(
      prisma as never,
      { signAsync } as never,
      config({
        MSAIDIZI_AUTONOMY_ENABLED: 'true',
        MSAIDIZI_GLOBAL_KILL_SWITCH: 'false',
      }),
    );

    await expect(service.issue({ taskId: 'task-1', stepId: 'step-1' })).rejects.toThrow(
      'ERP execution requires the task initiating user record',
    );
    expect(attemptFindFirst).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
  });
});
