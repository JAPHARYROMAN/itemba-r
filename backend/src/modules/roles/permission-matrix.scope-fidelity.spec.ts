import { RoleScope } from '@prisma/client';
import { extractCapabilities } from '../../common/capabilities/capability-manifest';
import { loadAllControllers } from '../../common/capabilities/load-controllers';
import { ALL_PERMISSIONS, ROLES, type PermDef } from '../../../../database/seeds/permission-matrix';

const TENANT_OR_ACTOR_SCOPED_MANIFEST_ADDITIONS = [
  'active_sessions.manage',
  'alert_events.acknowledge',
  'alert_events.dismiss',
  'alert_events.resolve',
  'alert_events.view',
  'alert_rules.manage',
  'alert_rules.view',
  'approval_delegations.manage',
  'approval_delegations.view',
  'approval_requests.approve',
  'approval_requests.cancel',
  'approval_requests.create',
  'approval_requests.reject',
  'approval_requests.view',
  'approval_steps.manage',
  'approval_steps.view',
  'approval_workflows.manage',
  'approval_workflows.view',
  'approvals.dashboard.view',
  'dashboard_preferences.manage',
  'data_exports.manage',
  'internal_controls.manage',
  'internal_controls.view',
  'notifications.manage',
  'notifications.view',
  'refunds.manage',
  'refunds.view',
  'sales_orders.confirm',
  'sales_orders.create',
  'sales_orders.view',
  'saved_report_views.manage',
  'saved_report_views.share',
  'saved_report_views.view',
  'scheduled_reports.manage',
  'scheduled_reports.run',
  'scheduled_reports.view',
  'security.policies.manage',
  'security.policies.view',
  'security_events.manage',
  'statutory_deduction_rules.manage',
  'statutory_deduction_rules.view',
  'tasks.cancel',
  'tasks.complete',
  'tasks.create',
  'tasks.update',
  'tasks.view',
] as const;

const DATA_ISOLATION_GROUP_CONTROL = [
  'data_isolation.resolve_issues',
  'data_isolation.run_tests',
  'data_isolation.sensitive.view',
  'data_isolation.view',
] as const;

describe('permission matrix scope fidelity', () => {
  const byCode = new Map(ALL_PERMISSIONS.map((permission) => [permission.code, permission]));

  it('defines every guarded manifest permission exactly once', () => {
    const matrixCodes = ALL_PERMISSIONS.map((permission) => permission.code);
    expect(new Set(matrixCodes).size).toBe(matrixCodes.length);

    const manifestCodes = new Set(
      extractCapabilities(loadAllControllers()).flatMap((capability) => [
        ...capability.permissions,
        ...capability.anyPermissions,
      ]),
    );
    expect([...manifestCodes].filter((code) => !byCode.has(code)).sort()).toEqual([]);
  });

  it('classifies the 46 recovered tenant/actor-scoped guards as non-group-control', () => {
    expect(TENANT_OR_ACTOR_SCOPED_MANIFEST_ADDITIONS).toHaveLength(46);
    expect(
      TENANT_OR_ACTOR_SCOPED_MANIFEST_ADDITIONS.map((code) => byCode.get(code)).filter(
        (permission): permission is PermDef => Boolean(permission),
      ),
    ).toHaveLength(46);
    expect(
      TENANT_OR_ACTOR_SCOPED_MANIFEST_ADDITIONS.filter(
        (code) => byCode.get(code)?.isGroupControl !== false,
      ),
    ).toEqual([]);
  });

  it('marks every data-isolation permission as group-control', () => {
    const definitions = ALL_PERMISSIONS.filter(
      (permission) => permission.module === 'data_isolation',
    );
    expect(definitions.map((permission) => permission.code).sort()).toEqual(
      [...DATA_ISOLATION_GROUP_CONTROL].sort(),
    );
    expect(definitions.every((permission) => permission.isGroupControl)).toBe(true);
  });

  it('never grants data-isolation or any other group-control permission to a seeded non-GROUP role', () => {
    const groupControlPermissions = ALL_PERMISSIONS.filter(
      (permission) => permission.isGroupControl,
    );
    const violations = ROLES.filter((role) => role.scope !== RoleScope.GROUP).flatMap((role) =>
      groupControlPermissions
        .filter(role.filter)
        .map((permission) => `${role.name}:${permission.code}`),
    );

    expect(violations).toEqual([]);
    for (const code of DATA_ISOLATION_GROUP_CONTROL) {
      const permission = byCode.get(code)!;
      expect(
        ROLES.filter((role) => role.filter(permission)).every(
          (role) => role.scope === RoleScope.GROUP,
        ),
      ).toBe(true);
    }
  });
});
