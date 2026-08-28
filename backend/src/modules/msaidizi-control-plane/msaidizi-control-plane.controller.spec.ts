import { AGENT_EXCLUDED_KEY } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziMandatesController } from './msaidizi-mandates.controller';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';
import { MsaidiziMemoryController } from './msaidizi-memory.controller';
import { MsaidiziSchedulesController } from './msaidizi-schedules.controller';
import { MsaidiziSchedulesService } from './msaidizi-schedules.service';
import { MsaidiziSafetyController } from './msaidizi-safety.controller';

const USER: AuthUser = {
  id: 'user-1',
  email: 'manager@itemba.local',
  roles: ['manager'],
  roleScopes: ['COMPANY'],
  permissions: ['msaidizi.use'],
  companyId: 'company-1',
  companyAccess: [],
};

describe('Msaidizi control-plane route isolation', () => {
  it.each([MsaidiziMandatesController, MsaidiziSchedulesController, MsaidiziMemoryController])(
    '%p is excluded from agent tool discovery and requires msaidizi.use',
    (controller) => {
      expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, controller)).toBe(true);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller)).toEqual(['msaidizi.use']);
    },
  );

  it('requires oversight before unattended authority can be activated', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziMandatesController.prototype.activate),
    ).toEqual(['msaidizi.use', 'msaidizi.oversight']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziSchedulesController.prototype.activate),
    ).toEqual(['msaidizi.use', 'msaidizi.oversight']);
  });

  it('keeps the global safety latch human-only and oversight-gated', () => {
    expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, MsaidiziSafetyController)).toBe(true);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MsaidiziSafetyController)).toEqual([
      'msaidizi.use',
      'msaidizi.oversight',
    ]);
  });

  it('delegates scoped immutable mandate history reads', () => {
    const mandates = {
      listVersions: jest.fn().mockReturnValue(['history']),
      findVersion: jest.fn().mockReturnValue({ version: 2 }),
    };
    const controller = new MsaidiziMandatesController(
      mandates as unknown as MsaidiziMandatesService,
    );

    expect(controller.listVersions('mandate-1', USER)).toEqual(['history']);
    expect(controller.findVersion('mandate-1', 2, USER)).toEqual({ version: 2 });
    expect(mandates.listVersions).toHaveBeenCalledWith('mandate-1', USER);
    expect(mandates.findVersion).toHaveBeenCalledWith('mandate-1', 2, USER);
  });

  it('delegates routine history and requires exact versions for lifecycle actions', () => {
    const schedules = {
      listVersions: jest.fn().mockReturnValue(['history']),
      findVersion: jest.fn().mockReturnValue({ version: 3 }),
      activate: jest.fn(),
      pause: jest.fn(),
    };
    const controller = new MsaidiziSchedulesController(
      schedules as unknown as MsaidiziSchedulesService,
    );

    expect(controller.listVersions('schedule-1', USER)).toEqual(['history']);
    expect(controller.findVersion('schedule-1', 3, USER)).toEqual({ version: 3 });
    controller.activate('schedule-1', USER, { expectedVersion: 2 });
    controller.pause('schedule-1', USER, { expectedVersion: 3 });

    expect(schedules.listVersions).toHaveBeenCalledWith('schedule-1', USER);
    expect(schedules.findVersion).toHaveBeenCalledWith('schedule-1', 3, USER);
    expect(schedules.activate).toHaveBeenCalledWith('schedule-1', USER, 2);
    expect(schedules.pause).toHaveBeenCalledWith('schedule-1', USER, 3);
  });
});
