-- Sales and cashier operators can negotiate sale prices. Price changes remain
-- attributed and subject to the below-cost check and the POS draft review flow.
-- Production deploys skip seeding, so update existing role grants here too.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT role.id, permission.id
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role.name IN ('MOBILE_POS_CASHIER', 'CASHIER', 'SALESPERSON')
  AND permission.code IN ('mobile_pos_lite.edit_price', 'mobile_pos_lite.edit_price_unlimited')
ON CONFLICT DO NOTHING;
