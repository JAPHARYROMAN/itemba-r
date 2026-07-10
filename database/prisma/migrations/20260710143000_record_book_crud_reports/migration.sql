-- Add the explicit delete permission for audit-safe Records Book soft deletion.
INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES (
  'perm-record-book-delete',
  'record_book.delete',
  'Soft-delete draft record book entries',
  'record_book',
  'delete',
  false
)
ON CONFLICT ("code") DO UPDATE
SET
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "isGroupControl" = EXCLUDED."isGroupControl";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('GROUP_SUPER_ADMIN', 'GROUP_FINANCE_CONTROLLER', 'ACCOUNTANT')
  AND p.code = 'record_book.delete'
ON CONFLICT DO NOTHING;
