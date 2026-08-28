import {
  MsaidiziHostActionStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskStatus,
} from '@prisma/client';
import { MsaidiziDevicesService } from './msaidizi-devices.service';

interface ClaimApi {
  claimExecuteCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
}

describe('device dispatch operator latch', () => {
  it.each([
    ['disabled principal', MsaidiziTaskStatus.RUNNING, MsaidiziPrincipalStatus.DISABLED],
    ['pausing task', MsaidiziTaskStatus.PAUSING, MsaidiziPrincipalStatus.ACTIVE],
  ])(
    'does not first-dispatch a queued host action for a %s',
    async (_label, taskStatus, status) => {
      const updateMany = jest.fn();
      const signer = { issue: jest.fn() };
      const prisma = {
        msaidiziHostAction: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'host-action-1',
              status: MsaidiziHostActionStatus.QUEUED,
              task: {
                status: taskStatus,
                principal: { status },
              },
            },
          ]),
          updateMany,
        },
      };
      const service = new MsaidiziDevicesService(
        prisma as never,
        { redeliverySeconds: 15 } as never,
        signer as never,
        {} as never,
      );

      const command = await (service as unknown as ClaimApi).claimExecuteCommand('device-1', {
        journalHeadHash: 'a'.repeat(64),
        centralLedgerConnected: true,
      });

      expect(command).toBeNull();
      expect(signer.issue).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    },
  );
});
