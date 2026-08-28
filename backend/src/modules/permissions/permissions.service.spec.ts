import { PermissionsService } from './permissions.service';

const USER = { id: 'user-a' } as any;
const PERMISSION = {
  id: 'permission-1',
  code: 'crud.execute',
  description: 'Execute CRUD evidence',
  module: 'crud',
  action: 'execute',
};

function harness() {
  const prisma = {
    permission: {
      create: jest.fn().mockResolvedValue(PERMISSION),
      delete: jest.fn().mockResolvedValue(PERMISSION),
    },
  } as any;
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new PermissionsService(prisma, audit as any);
  return { audit, service };
}

describe('PermissionsService mutation audit attribution', () => {
  it('create appends exactly one attributable audit row', async () => {
    const { audit, service } = harness();

    await service.create(PERMISSION, USER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PERMISSION_CREATE',
        entityType: 'Permission',
        entityId: PERMISSION.id,
        userId: USER.id,
        companyId: null,
      }),
    );
  });

  it('remove appends exactly one attributable audit row', async () => {
    const { audit, service } = harness();

    await service.remove(PERMISSION.id, USER);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PERMISSION_DELETE',
        entityType: 'Permission',
        entityId: PERMISSION.id,
        userId: USER.id,
        companyId: null,
      }),
    );
  });
});
