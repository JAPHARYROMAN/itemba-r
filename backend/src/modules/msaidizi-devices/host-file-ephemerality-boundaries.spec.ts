import {
  MsaidiziPrincipalStatus,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
} from '@prisma/client';
import { HostActionPolicyError, MsaidiziDevicesService } from './msaidizi-devices.service';
import { REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY } from './host-file-ephemerality.policy';

describe('host file credential ephemerality boundaries', () => {
  it.each(['filesystem.file.read', 'filesystem.file.disclose.ephemeral'])(
    'rejects a forged %s step before input resolution, lease, or dispatch',
    async (capability) => {
      const step = {
        id: 'step-1',
        taskId: 'task-1',
        planVersionId: 'plan-1',
        status: MsaidiziTaskStepStatus.RUNNING,
        capability,
        arguments: {
          rootId: 'managed',
          relativePath: 'credentials.pdf',
          maxBytes: 524_288,
        },
        task: {
          status: MsaidiziTaskStatus.RUNNING,
          principal: { status: MsaidiziPrincipalStatus.ACTIVE },
        },
        planVersion: { id: 'plan-1', version: 1 },
      };
      const prisma = {
        msaidiziTaskStep: { findFirst: jest.fn().mockResolvedValue(step) },
        msaidiziToolAttempt: { findFirst: jest.fn() },
        msaidiziDevice: { findFirst: jest.fn() },
        $transaction: jest.fn(),
      };
      const service = new MsaidiziDevicesService(
        prisma as never,
        { channelReady: () => true } as never,
        { assertReady: jest.fn() } as never,
        {} as never,
      );

      await expect(service.queueHostAction('task-1', 'step-1', 'attempt-1')).rejects.toEqual(
        expect.objectContaining<Partial<HostActionPolicyError>>({
          code: REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
        }),
      );

      expect(prisma.msaidiziToolAttempt.findFirst).not.toHaveBeenCalled();
      expect(prisma.msaidiziDevice.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
