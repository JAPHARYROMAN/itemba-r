-- Party linkage, Phase 2 (D6): the NoteBook's debtor and creditor registers open to the
-- roles that already read the Records Book. Additive: grants records.view to every role
-- holding record_book.view; nothing is removed and management stays with records.manage.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT rp."roleId", p."id"
FROM "role_permissions" rp
JOIN "permissions" rb ON rb."id" = rp."permissionId" AND rb."code" = 'record_book.view'
CROSS JOIN "permissions" p
WHERE p."code" = 'records.view'
ON CONFLICT DO NOTHING;
