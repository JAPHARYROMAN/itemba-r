-- Seed Records Book permissions that were introduced with the module.
-- This is intentionally idempotent because production may already have
-- permissions from a manual seed or a prior partial rollout.

INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
  ('perm-record-book-view', 'record_book.view', 'View record book entries', 'record_book', 'view', false),
  ('perm-record-book-create', 'record_book.create', 'Create record book entries', 'record_book', 'create', false),
  ('perm-record-book-update', 'record_book.update', 'Update record book entries', 'record_book', 'update', false),
  ('perm-record-book-finalize', 'record_book.finalize', 'Finalize record book entries', 'record_book', 'finalize', false),
  ('perm-record-book-void', 'record_book.void', 'Void record book entries', 'record_book', 'void', false),
  ('perm-record-book-admin', 'record_book.admin', 'Administer finalized record book entries', 'record_book', 'admin', false),
  ('perm-record-book-export', 'record_book.export', 'Export record book entries', 'record_book', 'export', false)
ON CONFLICT ("code") DO UPDATE
SET
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "isGroupControl" = EXCLUDED."isGroupControl";

-- Group administrators get full access.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'GROUP_SUPER_ADMIN'
  AND p.module = 'record_book'
ON CONFLICT DO NOTHING;

-- Group directors can view/export manual daily records.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'GROUP_DIRECTOR'
  AND p.module = 'record_book'
  AND p.action IN ('view', 'export')
ON CONFLICT DO NOTHING;

-- Finance/accounting can manage the Records Book.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('GROUP_FINANCE_CONTROLLER', 'ACCOUNTANT')
  AND p.module = 'record_book'
ON CONFLICT DO NOTHING;

-- Branch cashiers can capture, finalize, and export day records, but not admin-reopen or void.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'CASHIER'
  AND p.module = 'record_book'
  AND p.action IN ('view', 'create', 'update', 'finalize', 'export')
ON CONFLICT DO NOTHING;
