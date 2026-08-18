/**
 * ITEMBA-R — `MSAIDIZI_USER`, the supported way to grant Msaidizi deliberately.
 *
 * Per the integration plan's D4 (§5), `msaidizi.use` is seeded to
 * `GROUP_SUPER_ADMIN` and to no other role. Anyone else who should reach the
 * agent is granted it one at a time, and this role is how.
 *
 * **Why a separate role rather than widening a seeded one.** `seed.ts` does a
 * full replace of every role in its `ROLES` matrix — `rolePermission.deleteMany`
 * then `createMany` — so for a *system* role the matrix file, not the database,
 * is the source of truth. A grant added through `PATCH /roles/:id` to
 * `COMPANY_MANAGER` works, survives until the next deployment, and is then
 * silently reverted with no error and no audit event to explain it. That is the
 * trap this role exists to avoid.
 *
 * `MSAIDIZI_USER` is deliberately **not** in `ROLES`, so:
 *   • the seed's full-replace loop never touches its permissions;
 *   • it is created with `isSystem: false` (the schema default), which keeps it
 *     deletable through `DELETE /roles/:id` — system roles are refused there;
 *   • whatever an administrator does to it through the API is durable.
 *
 * The provisioning below is **create-if-absent and otherwise hands off**. Once
 * the role exists, this file never edits its permissions, its name, or its
 * description again. Re-running the seed after an administrator has widened or
 * narrowed it must not undo their decision — that is the entire point.
 *
 * Granting it to a person is a separate, deliberate act: assign the role
 * alongside their existing one via `users.assign_roles`. Because a user's
 * permissions are the union across their roles, this adds the agent to someone
 * without altering anything else they can do. Revoking is the same act in
 * reverse — unassign the role, and the permission cache picks it up within its
 * 60 s TTL with no re-login.
 */
import { PrismaClient, RoleScope } from '../../backend/node_modules/@prisma/client';

export const MSAIDIZI_USER_ROLE_NAME = 'MSAIDIZI_USER';

/**
 * The baseline the role is *created* with — not a set that is re-asserted.
 *
 * `msaidizi.use` is the permission to talk to the agent at all. It confers no
 * data access of its own: the agent acts under whatever else the holder is
 * granted, so adding this role to someone widens who may use Msaidizi, never
 * what Msaidizi can reach on their behalf.
 *
 * `msaidizi.procedures.view` comes with it so a holder can see the saved
 * procedures they are expected to run. `manage` and `approve` are deliberately
 * excluded: authoring a procedure and approving one are the two halves of the
 * maker-checker split, and handing both to a pilot user collapses it.
 */
const BASELINE_PERMISSION_CODES = ['msaidizi.use', 'msaidizi.procedures.view'];

/**
 * Create `MSAIDIZI_USER` if it does not exist. Leave it completely alone if it
 * does.
 *
 * Safe to run against a deployment where an administrator has already changed
 * the role: the existence check short-circuits before any write, so a widened,
 * narrowed, or renamed-in-description role is returned untouched.
 *
 * Re-creating the role after someone deleted it grants nobody anything — a role
 * with no holders is inert, since permissions reach a user only through
 * `userRoles`. So the idempotent create is not a way of quietly restoring
 * revoked access.
 */
export async function seedMsaidiziUserRole(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.role.findUnique({
    where: { name: MSAIDIZI_USER_ROLE_NAME },
    include: { _count: { select: { rolePermissions: true, userRoles: true } } },
  });

  if (existing) {
    console.log(
      `      ${MSAIDIZI_USER_ROLE_NAME}: exists — left untouched ` +
        `(${existing._count.rolePermissions} permission(s), ${existing._count.userRoles} holder(s))`,
    );
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: { code: { in: BASELINE_PERMISSION_CODES } },
    select: { id: true, code: true },
  });

  // The permission vocabulary is seeded earlier in the same run, so a miss here
  // means the definitions were removed from the matrix — which would also have
  // orphaned the `@RequirePermissions('msaidizi.use')` decorators on the
  // controllers. Fail loudly rather than create a role that grants nothing.
  const missing = BASELINE_PERMISSION_CODES.filter(
    (code) => !permissions.some((p) => p.code === code),
  );
  if (missing.length > 0) {
    throw new Error(
      `Cannot provision ${MSAIDIZI_USER_ROLE_NAME}: permission(s) not defined: ${missing.join(', ')}`,
    );
  }

  await prisma.role.create({
    data: {
      name: MSAIDIZI_USER_ROLE_NAME,
      displayName: 'Msaidizi User',
      description:
        'Grants access to the Msaidizi assistant. The agent acts under the ' +
        "holder's own permissions, so this widens who may use it, not what it " +
        'can reach. Assign alongside a person’s existing role. Not a system ' +
        'role: edits made through the API are durable and survive re-seeding.',
      scope: RoleScope.COMPANY,
      // isSystem is left at its schema default of false on purpose. See the
      // file header: a system role would be full-replaced by the next seed run
      // and could not be deleted through the API.
      rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });

  console.log(
    `      ${MSAIDIZI_USER_ROLE_NAME}: created (non-system, ${permissions.length} permissions, 0 holders)`,
  );
}
