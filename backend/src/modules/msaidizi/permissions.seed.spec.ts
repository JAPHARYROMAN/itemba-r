/**
 * Msaidizi is admin-only by default (integration plan D4 / §5).
 *
 * These assertions run against the real seed matrix, not a copy of it. The
 * matrix was extracted out of `seed.ts` into `permission-matrix.ts` precisely so
 * it could be imported here — `seed.ts` calls `main()` at import time, so
 * importing it would run the seed against whatever database the environment
 * points at.
 */
import { ALL_PERMISSIONS, ROLES, type PermDef } from '../../../../database/seeds/permission-matrix';
import {
  MSAIDIZI_USER_ROLE_NAME,
  seedMsaidiziUserRole,
} from '../../../../database/seeds/msaidizi-user-role';

const MSAIDIZI_PERMS: PermDef[] = ALL_PERMISSIONS.filter(
  (p) => p.module === 'msaidizi' || p.module.startsWith('msaidizi.'),
);

/** Every msaidizi permission code a role's filter would grant. */
function msaidiziGrantsOf(roleName: string): string[] {
  const role = ROLES.find((r) => r.name === roleName);
  if (!role) throw new Error(`No such role in the seed matrix: ${roleName}`);
  return MSAIDIZI_PERMS.filter(role.filter).map((p) => p.code);
}

describe('the msaidizi permission vocabulary', () => {
  it('still defines all four codes', () => {
    // The definitions stay even though almost nobody is granted them: they are
    // the vocabulary. Removing one would orphan the matching
    // @RequirePermissions decorator and make that route unreachable by anyone,
    // including the admin.
    expect(MSAIDIZI_PERMS.map((p) => p.code).sort()).toEqual([
      'msaidizi.procedures.approve',
      'msaidizi.procedures.manage',
      'msaidizi.procedures.view',
      'msaidizi.use',
    ]);
  });
});

describe('who the seed grants msaidizi to', () => {
  it('does not grant msaidizi.use to GROUP_DIRECTOR', () => {
    expect(msaidiziGrantsOf('GROUP_DIRECTOR')).not.toContain('msaidizi.use');
  });

  it('does not grant msaidizi.use to COMPANY_MANAGER', () => {
    expect(msaidiziGrantsOf('COMPANY_MANAGER')).not.toContain('msaidizi.use');
  });

  it('grants every msaidizi permission to GROUP_SUPER_ADMIN', () => {
    // `filter: all` — so this role also picks up any msaidizi permission added
    // later (msaidizi.oversight, say) without an edit here. That is the intended
    // posture: the owner's account gets each new one by default, nobody else
    // does.
    expect(msaidiziGrantsOf('GROUP_SUPER_ADMIN').sort()).toEqual(
      MSAIDIZI_PERMS.map((p) => p.code).sort(),
    );
  });

  it('grants msaidizi to GROUP_SUPER_ADMIN and to no other seeded role', () => {
    // The load-bearing assertion. The two named roles above are the ones the
    // plan called out, but they were not the only leaks: GROUP_AUDITOR held
    // msaidizi.procedures.view through the same mechanism. Enumerating every
    // role means the next broadly-filtered role added to the matrix fails here
    // instead of quietly reopening the default.
    const holders = ROLES.filter((r) => MSAIDIZI_PERMS.some(r.filter)).map((r) => r.name);
    expect(holders).toEqual(['GROUP_SUPER_ADMIN']);
  });

  it('withholds the procedures permissions from every role but the admin', () => {
    // Coherence with msaidizi.use: a role that cannot talk to the agent has no
    // business viewing, authoring or approving the procedures it would run.
    for (const code of [
      'msaidizi.procedures.view',
      'msaidizi.procedures.manage',
      'msaidizi.procedures.approve',
    ]) {
      const holders = ROLES.filter((r) =>
        MSAIDIZI_PERMS.filter(r.filter).some((p) => p.code === code),
      ).map((r) => r.name);
      expect(holders).toEqual(['GROUP_SUPER_ADMIN']);
    }
  });

  it('is not achievable by deleting inModules entries alone', () => {
    // A regression guard on the reasoning, not just the result. `combine` is a
    // logical OR, so a role keeps a permission if ANY clause matches. Two
    // clauses in this matrix match msaidizi permissions on their own:
    //   • notGroupCtrl  — matches every non-group-control permission
    //     (COMPANY_MANAGER carries a bare one, so deleting 'msaidizi' from its
    //     inModules list changed nothing at all)
    //   • readExport    — matches action === 'view'
    //     (so msaidizi.procedures.view survived in GROUP_DIRECTOR and
    //     GROUP_AUDITOR)
    // If someone "simplifies" the structural exclusion away and relies on the
    // module lists again, these two roles light up.
    const notGroupCtrl = (p: PermDef) => !p.isGroupControl && p.module !== 'hr_governance';
    const readExport = (p: PermDef) =>
      p.action === 'read' ||
      p.action === 'export' ||
      p.action === 'view' ||
      p.action === 'reports.view';

    expect(MSAIDIZI_PERMS.filter(notGroupCtrl).map((p) => p.code)).toEqual(
      MSAIDIZI_PERMS.map((p) => p.code),
    );
    expect(MSAIDIZI_PERMS.filter(readExport).map((p) => p.code)).toEqual([
      'msaidizi.procedures.view',
    ]);
  });

  it('leaves the non-msaidizi grants of the narrowed roles alone', () => {
    // The exclusion must subtract msaidizi and nothing else. If a future edit
    // widens the predicate — matching 'msaidizi' as a substring, say — a role
    // would silently lose unrelated permissions, and that is the kind of
    // regression a seed run applies to production without a migration to
    // reverse it.
    for (const name of ['GROUP_DIRECTOR', 'COMPANY_MANAGER', 'GROUP_AUDITOR']) {
      const role = ROLES.find((r) => r.name === name)!;
      const granted = ALL_PERMISSIONS.filter(role.filter);
      expect(granted.length).toBeGreaterThan(100);
      expect(granted.some((p) => p.module.startsWith('msaidizi'))).toBe(false);
    }
  });
});

describe('MSAIDIZI_USER — the deliberate grant, and why it survives', () => {
  it('is absent from the seeded role matrix', () => {
    // This is the whole mechanism. `seed.ts` iterates ROLES and, per role, does
    // rolePermission.deleteMany(...) then createMany(...) — a full replace. A
    // role the loop never visits is a role the loop cannot overwrite, so the
    // only durable way to hold msaidizi.use is a role that is not in here.
    expect(ROLES.map((r) => r.name)).not.toContain(MSAIDIZI_USER_ROLE_NAME);
  });

  it('is created non-system, so the API can still delete it', () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = fakePrisma({ existingRole: null, created });

    return seedMsaidiziUserRole(prisma).then(() => {
      expect(created).toHaveLength(1);
      // `isSystem` is never set, so it takes the schema default of false.
      // A system role is refused by DELETE /roles/:id, which would make the
      // pilot grant impossible to retire cleanly.
      expect(created[0]).not.toHaveProperty('isSystem');
      expect(created[0].name).toBe(MSAIDIZI_USER_ROLE_NAME);
    });
  });

  it('grants use + procedures.view, but never manage or approve', () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = fakePrisma({ existingRole: null, created });

    return seedMsaidiziUserRole(prisma).then(() => {
      const codes = (prisma.__lastPermissionQuery as string[]).sort();
      // Authoring a procedure and approving one are the two halves of the
      // maker-checker split; handing a pilot user both collapses it.
      expect(codes).toEqual(['msaidizi.procedures.view', 'msaidizi.use']);
      expect(codes).not.toContain('msaidizi.procedures.manage');
      expect(codes).not.toContain('msaidizi.procedures.approve');
    });
  });

  it('survives a re-seed with its permissions untouched', () => {
    // The scenario that matters: an administrator widened the role after it was
    // provisioned, then the next deployment ran the seed. On a system role the
    // widening would be silently reverted. Here nothing is written at all.
    const created: Array<Record<string, unknown>> = [];
    const updated: Array<Record<string, unknown>> = [];
    const deletedPermissionsFor: string[] = [];
    const prisma = fakePrisma({
      existingRole: {
        id: 'role-msaidizi-user',
        name: MSAIDIZI_USER_ROLE_NAME,
        isSystem: false,
        _count: { rolePermissions: 7, userRoles: 2 },
      },
      created,
      updated,
      deletedPermissionsFor,
    });

    return seedMsaidiziUserRole(prisma).then(() => {
      expect(created).toHaveLength(0);
      expect(updated).toHaveLength(0);
      // Not even a permission re-assertion: no delete, no create. The
      // administrator's 7 permissions and 2 holders are exactly as they were.
      expect(deletedPermissionsFor).toEqual([]);
    });
  });

  it('refuses to create a role that would grant nothing', () => {
    // If the permission definitions were removed from the matrix, silently
    // creating an empty MSAIDIZI_USER would look like the grant had been made.
    const prisma = fakePrisma({ existingRole: null, created: [], permissionsInDb: [] });
    return expect(seedMsaidiziUserRole(prisma)).rejects.toThrow(/not defined/);
  });
});

/**
 * A stand-in for PrismaClient covering only what `seedMsaidiziUserRole` calls.
 * A real client would need a database; the behaviour under test is which writes
 * are issued, which is observable without one.
 */
type PrismaArg = Parameters<typeof seedMsaidiziUserRole>[0];
type FakePrisma = PrismaArg & { __lastPermissionQuery?: string[] };

function fakePrisma(opts: {
  existingRole: Record<string, unknown> | null;
  created: Array<Record<string, unknown>>;
  updated?: Array<Record<string, unknown>>;
  deletedPermissionsFor?: string[];
  permissionsInDb?: Array<{ id: string; code: string }>;
}): FakePrisma {
  const permissionsInDb = opts.permissionsInDb ?? [
    { id: 'perm-use', code: 'msaidizi.use' },
    { id: 'perm-proc-view', code: 'msaidizi.procedures.view' },
    { id: 'perm-proc-manage', code: 'msaidizi.procedures.manage' },
    { id: 'perm-proc-approve', code: 'msaidizi.procedures.approve' },
  ];

  const fake = {
    role: {
      findUnique: () => Promise.resolve(opts.existingRole),
      create: ({ data }: { data: Record<string, unknown> }) => {
        opts.created.push(data);
        return Promise.resolve({ id: 'new-role', ...data });
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        opts.updated?.push(data);
        return Promise.resolve({ id: 'new-role', ...data });
      },
    },
    permission: {
      findMany: ({ where }: { where: { code: { in: string[] } } }) => {
        fake.__lastPermissionQuery = where.code.in;
        return Promise.resolve(permissionsInDb.filter((p) => where.code.in.includes(p.code)));
      },
    },
    rolePermission: {
      deleteMany: ({ where }: { where: { roleId: string } }) => {
        opts.deletedPermissionsFor?.push(where.roleId);
        return Promise.resolve({ count: 0 });
      },
    },
    __lastPermissionQuery: undefined as string[] | undefined,
  };
  return fake as unknown as FakePrisma;
}
