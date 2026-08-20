-- Stage-one Fuel Grid bridge: permission-gated access to the separately
-- deployed and separately authenticated application.

INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES (
  'perm-fuel-grid-access',
  'fuel_grid.access',
  'Open the independent Fuel Grid application',
  'fuel_grid',
  'access',
  true
)
ON CONFLICT ("code") DO UPDATE
SET
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "isGroupControl" = EXCLUDED."isGroupControl";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT role.id, permission.id
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role.name = 'GROUP_SUPER_ADMIN'
  AND permission.code = 'fuel_grid.access'
ON CONFLICT DO NOTHING;
