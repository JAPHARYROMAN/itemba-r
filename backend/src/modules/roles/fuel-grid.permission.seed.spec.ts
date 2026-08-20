import { ALL_PERMISSIONS, ROLES } from '../../../../database/seeds/permission-matrix';

describe('Fuel Grid launcher permission', () => {
  const permission = ALL_PERMISSIONS.find((entry) => entry.code === 'fuel_grid.access');

  it('defines the independent application access permission', () => {
    expect(permission).toMatchObject({
      module: 'fuel_grid',
      action: 'access',
      isGroupControl: true,
    });
  });

  it('grants the stage-one launcher only to the group super administrator', () => {
    if (!permission) throw new Error('fuel_grid.access permission is missing');

    const holders = ROLES.filter((role) => role.filter(permission)).map((role) => role.name);
    expect(holders).toEqual(['GROUP_SUPER_ADMIN']);
  });
});
