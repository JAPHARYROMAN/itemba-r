import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PERMISSIONS, ROLES } from '../../../../database/seeds/permission-matrix';

// Production deploys skip the seed, so a permission exists there only if a
// migration creates it. This keeps the migration and the matrix in step.
describe('Mobile POS price-edit permissions', () => {
  const migration = readFileSync(
    join(
      __dirname,
      '../../../../database/prisma/migrations/20260924090000_mobile_pos_price_edit_permissions/migration.sql',
    ),
    'utf8',
  );
  const codes = ['mobile_pos_lite.edit_price', 'mobile_pos_lite.edit_price_unlimited'];

  it.each(codes)('%s is created by a migration with the matrix description', (code) => {
    const permission = ALL_PERMISSIONS.find((entry) => entry.code === code);
    if (!permission) throw new Error(`${code} is missing from the matrix`);
    expect(migration).toContain(`'${code}'`);
    expect(migration).toContain(`'${permission.description}'`);
  });

  it.each(codes)('%s is granted by the migration to exactly the matrix roles', (code) => {
    const permission = ALL_PERMISSIONS.find((entry) => entry.code === code);
    if (!permission) throw new Error(`${code} is missing from the matrix`);
    const holders = ROLES.filter((role) => role.filter(permission)).map((role) => role.name);
    // The role list of the grant statement that names exactly this code.
    const statement = migration
      .split(';')
      .find((part) => part.includes('INTO "role_permissions"') && part.includes(`= '${code}'`));
    const roleList = statement?.slice(statement.indexOf('role.name IN ('));
    const granted = roleList?.slice(0, roleList.indexOf(')')).match(/'[A-Z_]+'/g) ?? [];
    expect(granted.map((name) => name.slice(1, -1)).sort()).toEqual([...holders].sort());
  });
});
