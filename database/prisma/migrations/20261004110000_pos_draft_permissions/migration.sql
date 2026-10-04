-- Additive permission rollout: production does not run the development seed.
INSERT INTO permissions (id, code, description, module, action, "isGroupControl", "createdAt")
SELECT gen_random_uuid()::text, code, description, module, action, false, CURRENT_TIMESTAMP
FROM (VALUES
  ('mobile_pos_lite.access', 'Open an approved capture-only POS device', 'mobile_pos_lite', 'access'),
  ('mobile_pos_onboarding.manage', 'Approve and manage scoped mobile POS identities', 'mobile_pos_onboarding', 'manage'),
  ('pos_drafts.view', 'View scoped POS drafts', 'pos_drafts', 'view'),
  ('pos_drafts.create', 'Capture scoped POS drafts', 'pos_drafts', 'create'),
  ('pos_drafts.dispatch', 'Prepare stock for POS drafts', 'pos_drafts', 'dispatch'),
  ('pos_drafts.approve', 'Approve POS drafts for posting', 'pos_drafts', 'approve'),
  ('pos_drafts.reject', 'Reject POS drafts with a reason', 'pos_drafts', 'reject'),
  ('pos_drafts.direct_post', 'Post an authorized administrator own POS transaction', 'pos_drafts', 'direct_post')
) AS additions(code, description, module, action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (id, name, "displayName", description, scope, "isSystem", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'MOBILE_POS_CASHIER', 'Mobile POS Cashier', 'Capture-only approved PIN cashier', 'BRANCH', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MOBILE_POS_STOCKIST', 'Mobile POS Stockist', 'Capture-only approved PIN stockist', 'BRANCH', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE
  (r.name IN ('GROUP_SUPER_ADMIN', 'COMPANY_MANAGER', 'BRANCH_MANAGER') AND p.module IN ('pos_drafts', 'mobile_pos_onboarding'))
  OR (r.scope = 'GROUP' AND p.module IN ('pos_drafts', 'mobile_pos_onboarding') AND EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions existing ON existing.id = rp."permissionId"
    WHERE rp."roleId" = r.id AND existing.code = 'mobile_pos_lite.manage'
  ))
  OR (r.name IN ('GROUP_DIRECTOR', 'GROUP_AUDITOR', 'GROUP_FINANCE_CONTROLLER') AND p.code = 'pos_drafts.view')
  OR (r.name = 'MOBILE_POS_CASHIER' AND p.code IN ('mobile_pos_lite.access', 'pos_drafts.view', 'pos_drafts.create'))
  OR (r.name = 'MOBILE_POS_STOCKIST' AND p.code IN ('mobile_pos_lite.access', 'pos_drafts.view', 'pos_drafts.create', 'pos_drafts.dispatch'))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
