-- POS price editing (remake phase 3) is gated by two permissions that were
-- only ever added to the seed matrix. Production deploys skip the seed, so
-- the rows never existed and no role could hold them: the price button never
-- showed. Create them and grant them to the roles the matrix gives them to.

INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
  (
    'perm-mobile-pos-lite-edit-price',
    'mobile_pos_lite.edit_price',
    'Change a selling price on a Mobile POS Lite sale, within the terminal limit',
    'mobile_pos_lite',
    'edit_price',
    false
  ),
  (
    'perm-mobile-pos-lite-edit-price-unlimited',
    'mobile_pos_lite.edit_price_unlimited',
    'Lower a Mobile POS Lite selling price beyond the terminal limit (never below cost)',
    'mobile_pos_lite',
    'edit_price_unlimited',
    false
  )
ON CONFLICT ("code") DO UPDATE
SET
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "isGroupControl" = EXCLUDED."isGroupControl";

-- Within the terminal limit: managers plus the people at the till.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT role.id, permission.id
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role.name IN ('GROUP_SUPER_ADMIN', 'COMPANY_MANAGER', 'BRANCH_MANAGER', 'CASHIER', 'SALESPERSON')
  AND permission.code = 'mobile_pos_lite.edit_price'
ON CONFLICT DO NOTHING;

-- Beyond the terminal limit (never below cost): managers only.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT role.id, permission.id
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role.name IN ('GROUP_SUPER_ADMIN', 'COMPANY_MANAGER', 'BRANCH_MANAGER')
  AND permission.code = 'mobile_pos_lite.edit_price_unlimited'
ON CONFLICT DO NOTHING;
