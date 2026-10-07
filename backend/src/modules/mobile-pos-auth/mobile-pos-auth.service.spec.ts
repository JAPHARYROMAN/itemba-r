import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MobilePosAuthService,
  mobilePosHash,
  mobilePosPermissions,
} from './mobile-pos-auth.service';
import { MobilePosSessionGuard } from '../../common/guards/mobile-pos-session.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { JwtRefreshStrategy } from '../auth/strategies/jwt-refresh.strategy';

jest.mock('argon2', () => ({
  hash: jest.fn(async (value: string) => 'hashed:' + value),
  verify: jest.fn(async (hash: string, value: string) => hash === 'hashed:' + value),
}));

const SECRET = 'a'.repeat(64);
const CLAIM = 'c'.repeat(32);
const future = () => new Date(Date.now() + 86400000);
const enrollment = (overrides: Record<string, unknown> = {}) => ({
  id: 'enrollment-a',
  branchSetupId: 'setup-a',
  companyId: 'company-a',
  divisionId: 'division-a',
  branchId: 'branch-a',
  name: 'Maua',
  requestedRole: 'CASHIER',
  approvedRole: 'CASHIER',
  status: 'APPROVED',
  userId: 'operator-a',
  terminalId: 'terminal-a',
  pinHash: 'hashed:123456',
  deviceSecretHash: mobilePosHash(SECRET),
  credentialVersion: 1,
  failedPinAttempts: 0,
  lockedUntil: null,
  claimTokenHash: mobilePosHash(CLAIM),
  claimExpiresAt: future(),
  setupTokenHash: null,
  setupExpiresAt: null,
  ...overrides,
});
function fixture(overrides: Record<string, unknown> = {}) {
  let state = enrollment(overrides);
  const setup = {
    id: 'setup-a',
    companyId: 'company-a',
    divisionId: 'division-a',
    branchId: 'branch-a',
    enabled: true,
    approvalRequired: true,
    paymentMappings: [],
  };
  const terminal = {
    id: 'terminal-a',
    terminalCode: 'MPL-TEST',
    status: 'ACTIVE',
    assignedUserId: 'operator-a',
    companyId: 'company-a',
    divisionId: 'division-a',
    branchId: 'branch-a',
    deviceSecretHash: mobilePosHash(SECRET),
  };
  const prisma: any = {
    mobilePosEnrollment: {
      findUnique: jest.fn(async () => ({ ...state, branchSetup: setup })),
      findUniqueOrThrow: jest.fn(async () => ({ ...state })),
      findFirst: jest.fn(async () => ({ ...state })),
      update: jest.fn(async ({ data }: any) => {
        state = {
          ...state,
          ...data,
          ...(data.credentialVersion?.increment
            ? { credentialVersion: state.credentialVersion + data.credentialVersion.increment }
            : {}),
        };
        return { ...state };
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        state = { ...state, ...data };
        return { count: 1 };
      }),
    },
    mobilePosBranchSetup: { findUnique: jest.fn(async () => setup) },
    mobilePosTerminal: {
      findUnique: jest.fn(async () => terminal),
      findUniqueOrThrow: jest.fn(async () => terminal),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(async () => []),
      create: jest.fn(),
      findUnique: jest.fn(async () => ({
        id: 'operator-a',
        authKind: 'POS_PIN',
        status: 'ACTIVE',
      })),
    },
    activeSession: {
      create: jest.fn(async () => ({ id: 'session-a' })),
      findUnique: jest.fn(async () => ({
        id: 'session-a',
        userId: 'operator-a',
        deviceId: 'enrollment-a',
        status: 'ACTIVE',
        sessionType: 'POS',
        expiresAt: future(),
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    refreshToken: { create: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    company: { findUniqueOrThrow: jest.fn(async () => ({ id: 'company-a', name: 'Company' })) },
    division: { findUniqueOrThrow: jest.fn(async () => ({ id: 'division-a', name: 'Division' })) },
    branch: { findUniqueOrThrow: jest.fn(async () => ({ id: 'branch-a', name: 'Branch' })) },
    $queryRaw: jest.fn(),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const jwt = { signAsync: jest.fn(async () => 'test-token'), verifyAsync: jest.fn() };
  const config = {
    get: jest.fn(() => undefined),
    getOrThrow: jest.fn(() => 'test-only-signing-secret'),
  };
  const audit = { logStrictInTransaction: jest.fn(), log: jest.fn() };
  const companyScope = { assertCanAccessCompany: jest.fn() };
  const organization = { assertCanAccessScope: jest.fn() };
  const notifications = {
    notifyMobilePosEnrollmentRequested: jest.fn(),
    notifyMobilePosEnrollmentDecision: jest.fn(),
  };
  const service = new MobilePosAuthService(
    prisma,
    jwt as any,
    config as any,
    audit as any,
    companyScope as any,
    organization as any,
    notifications as never,
  );
  return {
    service,
    prisma,
    jwt,
    audit,
    config,
    terminal,
    notifications,
    companyScope,
    organization,
    state: () => state,
  };
}
const manager: any = {
  id: 'admin-a',
  permissions: ['mobile_pos_onboarding.manage'],
  roleScopes: ['GROUP'],
};

describe('approved mobile PIN identity', () => {
  it('cannot disable the required office approval on a staff branch', async () => {
    const f = fixture();
    await expect(
      f.service.saveBranchSetup({ approvalRequired: false } as any, manager),
    ).rejects.toThrow(BadRequestException);
  });
  it('requires ADMIN review for an ADMIN request without changing it to a PIN identity', async () => {
    const f = fixture({
      status: 'PENDING',
      requestedRole: 'ADMIN',
      approvedRole: null,
      userId: null,
      terminalId: null,
      pinHash: null,
    });
    await expect(f.service.approve('enrollment-a', { role: 'CASHIER' }, manager)).rejects.toThrow(
      BadRequestException,
    );
    const result = await f.service.approve('enrollment-a', { role: 'ADMIN' }, manager);
    expect(result).toMatchObject({ status: 'APPROVED', approvedRole: 'ADMIN', adminLinked: false });
    expect(f.prisma.user.create).not.toHaveBeenCalled();
    expect(f.prisma.mobilePosEnrollment.update).not.toHaveBeenCalled();
  });

  it('does not bind a pending registration', async () => {
    const f = fixture({ status: 'PENDING', pinHash: null, approvedRole: null });
    await expect(
      f.service.setup({ claimToken: CLAIM, pin: '123456', deviceSecret: SECRET }),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.prisma.mobilePosEnrollment.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.activeSession.create).not.toHaveBeenCalled();
  });

  it('an atomic lost setup claim cannot issue sessions', async () => {
    const f = fixture({ pinHash: null, deviceSecretHash: null });
    f.prisma.mobilePosEnrollment.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.setup({ claimToken: CLAIM, pin: '123456', deviceSecret: SECRET }),
    ).rejects.toThrow(ConflictException);
    expect(f.prisma.activeSession.create).not.toHaveBeenCalled();
  });

  it('recovers a lost setup response only with the same bound device and correct PIN', async () => {
    const f = fixture();
    const result = await f.service.setup({
      claimToken: CLAIM,
      pin: '123456',
      deviceSecret: SECRET,
    });
    expect(result.enrollmentId).toBe('enrollment-a');
    expect(f.prisma.mobilePosTerminal.update).not.toHaveBeenCalled();
    await expect(
      f.service.setup({ claimToken: CLAIM, pin: '123456', deviceSecret: 'b'.repeat(64) }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('persists five PIN failures and denies a correct PIN during the 15-minute lock', async () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) {
      await expect(
        f.service.login({ enrollmentId: 'enrollment-a', deviceSecret: SECRET, pin: '999999' }),
      ).rejects.toThrow(UnauthorizedException);
    }
    expect(f.state().failedPinAttempts).toBe(5);
    expect((f.state().lockedUntil as Date | null)!.getTime()).toBeGreaterThan(
      Date.now() + 14 * 60000,
    );
    await expect(
      f.service.login({ enrollmentId: 'enrollment-a', deviceSecret: SECRET, pin: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.prisma.activeSession.create).not.toHaveBeenCalled();
  });

  it('requires device proof, even when the PIN is correct', async () => {
    const f = fixture();
    await expect(
      f.service.login({
        enrollmentId: 'enrollment-a',
        deviceSecret: 'b'.repeat(64),
        pin: '123456',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.prisma.activeSession.create).not.toHaveBeenCalled();
  });

  it('mints bounded POS access and refresh tokens with matching credential version', async () => {
    const f = fixture();
    const result = await f.service.login({
      enrollmentId: 'enrollment-a',
      deviceSecret: SECRET,
      pin: '123456',
    });
    expect(f.prisma.activeSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionType: 'POS', deviceId: 'enrollment-a' }),
    });
    expect(f.jwt.signAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tokenUse: 'mobile-pos', mobilePosCredentialVersion: 1 }),
      expect.objectContaining({ expiresIn: '15m' }),
    );
    expect(f.jwt.signAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tokenUse: 'mobile-pos-refresh', mobilePosCredentialVersion: 1 }),
      expect.objectContaining({ expiresIn: '8h' }),
    );
    expect(result.user.permissions).toEqual([
      'mobile_pos_lite.access',
      'pos_drafts.view',
      'pos_drafts.create',
      'mobile_pos_lite.edit_price',
      'mobile_pos_lite.edit_price_unlimited',
    ]);
    expect(result.user.email).toBe('');
  });

  it('reset issuance invalidates all existing device sessions immediately', async () => {
    const f = fixture();
    const result = await f.service.issueReset('enrollment-a', manager);
    expect(result.resetToken).toHaveLength(32);
    expect(f.state().credentialVersion).toBe(2);
    expect(f.state().setupTokenHash).not.toBe(result.resetToken);
    expect(f.prisma.activeSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED' }) }),
    );
  });

  it('rejects regular web refresh credentials on the mobile endpoint', async () => {
    const f = fixture();
    f.jwt.verifyAsync.mockResolvedValue({ sub: 'operator-a', sid: 'session-a' });
    await expect(f.service.refresh('ordinary-refresh', SECRET)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(f.prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('blocks the previous PIN while an administrator reset is pending', async () => {
    const f = fixture({ setupTokenHash: mobilePosHash(CLAIM), setupExpiresAt: future() });
    await expect(
      f.service.login({ enrollmentId: 'enrollment-a', deviceSecret: SECRET, pin: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.prisma.activeSession.create).not.toHaveBeenCalled();
  });

  it('recovers a completed PIN reset through new-PIN login without reusing the reset token', async () => {
    const f = fixture();
    const { resetToken } = await f.service.issueReset('enrollment-a', manager);
    await expect(
      f.service.resetPin({
        enrollmentId: 'enrollment-a',
        resetToken,
        deviceSecret: 'b'.repeat(64),
        pin: '654321',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.state().pinHash).toBe('hashed:123456');
    await f.service.resetPin({
      enrollmentId: 'enrollment-a',
      resetToken,
      deviceSecret: SECRET,
      pin: '654321',
    });
    expect(f.state()).toMatchObject({
      pinHash: 'hashed:654321',
      setupTokenHash: null,
      credentialVersion: 2,
    });
    await expect(
      f.service.resetPin({
        enrollmentId: 'enrollment-a',
        resetToken,
        deviceSecret: SECRET,
        pin: '999999',
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      f.service.login({ enrollmentId: 'enrollment-a', deviceSecret: SECRET, pin: '123456' }),
    ).rejects.toThrow(UnauthorizedException);
    const recovered = await f.service.login({
      enrollmentId: 'enrollment-a',
      deviceSecret: SECRET,
      pin: '654321',
    });
    expect(recovered.operator).toMatchObject({ id: 'operator-a', credentialVersion: 2 });
    expect(f.state().pinHash).toBe('hashed:654321');
  });
});

describe('mobile session API confinement', () => {
  const context = (user: any, method = 'GET', path = '/api/v1/sales-orders'): any => ({
    switchToHttp: () => ({ getRequest: () => ({ user, method, path }) }),
    getHandler: () => 'handler',
    getClass: () => 'controller',
  });
  it('denies a restricted token on handlers without an explicit allowlist', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => undefined) } as unknown as Reflector;
    const guard = new MobilePosSessionGuard(reflector, {} as any);
    await expect(
      guard.canActivate(context({ tokenUse: 'mobile-pos', mobilePosRole: 'CASHIER' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context({ id: 'ordinary-admin' }))).resolves.toBe(true);
  });
  it('does not let a cashier use the stockist dispatch handler', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => ['STOCKIST']) } as unknown as Reflector;
    const guard = new MobilePosSessionGuard(reflector, {} as any);
    await expect(
      guard.canActivate(context({ tokenUse: 'mobile-pos', mobilePosRole: 'CASHIER' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(context({ tokenUse: 'mobile-pos', mobilePosRole: 'STOCKIST' })),
    ).resolves.toBe(true);
  });

  it('blocks password-session ERP mutations for revoked or paused enrolled staff', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => undefined) } as unknown as Reflector;
    const prisma: any = {
      mobilePosEnrollment: {
        findFirst: jest.fn(async () => ({
          approvedRole: 'CASHIER',
          status: 'REVOKED',
          branchSetup: { enabled: false, approvalRequired: true },
        })),
      },
    };
    const guard = new MobilePosSessionGuard(reflector, prisma);
    const user: any = {
      id: 'staff',
      permissions: ['goods_received_notes.post'],
      roles: ['CASHIER'],
    };
    await expect(
      guard.canActivate(context(user, 'POST', '/api/v1/goods-received-notes/proof/post')),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context(user, 'GET'))).resolves.toBe(true);
    await expect(guard.canActivate(context(user, 'POST', '/api/v1/auth/logout'))).resolves.toBe(
      true,
    );
    reflector.getAllAndOverride = jest.fn(() => ['CASHIER']) as any;
    await expect(guard.canActivate(context(user, 'POST', '/api/v1/pos-drafts'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('projects an enrolled password user role for capture and keeps unassigned office managers unrestricted', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => ['CASHIER']) } as unknown as Reflector;
    const prisma: any = {
      mobilePosEnrollment: {
        findFirst: jest.fn(async () => ({
          approvedRole: 'CASHIER',
          status: 'APPROVED',
          branchSetup: { enabled: true, approvalRequired: true },
        })),
      },
    };
    const guard = new MobilePosSessionGuard(reflector, prisma);
    const user: any = { id: 'staff', permissions: ['pos_drafts.create'], roles: ['CASHIER'] };
    await expect(guard.canActivate(context(user, 'POST', '/api/v1/pos-drafts'))).resolves.toBe(
      true,
    );
    expect(user.mobilePosRole).toBe('CASHIER');
    prisma.mobilePosEnrollment.findFirst.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        context(
          {
            id: 'manager',
            permissions: ['mobile_pos_onboarding.manage'],
            roles: ['COMPANY_MANAGER'],
          },
          'POST',
        ),
      ),
    ).resolves.toBe(true);
  });

  it('cannot hide a configured historical assignment behind a first terminal in an unconfigured branch', async () => {
    const reflector = { getAllAndOverride: jest.fn(() => undefined) } as unknown as Reflector;
    const prisma: any = {
      mobilePosEnrollment: { findFirst: jest.fn(async () => null) },
      mobilePosTerminal: {
        findMany: jest.fn(async () => [{ branchId: 'unconfigured' }, { branchId: 'configured' }]),
      },
      mobilePosBranchSetup: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.branchId.in.includes('configured') ? { id: 'setup' } : null,
        ),
      },
    };
    const guard = new MobilePosSessionGuard(reflector, prisma);
    const user: any = { id: 'staff', permissions: ['grn.post'], roles: ['CASHIER'] };
    await expect(
      guard.canActivate(context(user, 'POST', '/api/v1/goods-received-notes/proof/post')),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context(user, 'GET'))).resolves.toBe(true);
  });

  it('projects live approval without consulting an admin-shaped permission cache', async () => {
    const f = fixture();
    const cache = { get: jest.fn(() => ({ permissions: ['users.assign_roles'] })), set: jest.fn() };
    const strategy = new JwtStrategy(f.config as any, f.prisma, cache as any, f.audit as any);
    const claims: any = {
      sub: 'operator-a',
      email: '',
      sid: 'session-a',
      tokenUse: 'mobile-pos',
      mobilePosEnrollmentId: 'enrollment-a',
      mobilePosTerminalId: 'terminal-a',
      mobilePosCredentialVersion: 1,
    };
    const user = await strategy.validate(claims);
    expect(user.permissions).toEqual(mobilePosPermissions('CASHIER'));
    expect(user.permissions).not.toContain('users.assign_roles');
    expect(cache.get).not.toHaveBeenCalled();
    expect(user.branchAccess).toEqual([{ branchId: 'branch-a', accessLevel: 'READ' }]);
    f.prisma.mobilePosEnrollment.findUnique.mockResolvedValue({
      ...enrollment(),
      branchSetup: { enabled: true },
      credentialVersion: 2,
    });
    await expect(strategy.validate(claims)).rejects.toThrow(UnauthorizedException);
  });

  it('denies POS refresh tokens through ordinary auth refresh', async () => {
    const f = fixture();
    const strategy = new JwtRefreshStrategy(f.config as any);
    await expect(
      strategy.validate(
        { headers: { authorization: 'Bearer test-only' } } as any,
        { sub: 'operator-a', email: '', tokenUse: 'mobile-pos-refresh' } as any,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['session belongs to another operator', 'activeSession', { userId: 'operator-b' }],
    ['session belongs to another enrollment', 'activeSession', { deviceId: 'enrollment-b' }],
    ['ordinary session is not a POS session', 'activeSession', { sessionType: 'WEB' }],
    ['session is revoked', 'activeSession', { status: 'REVOKED' }],
    ['enrollment is revoked', 'mobilePosEnrollment', { status: 'REVOKED' }],
    ['enrollment changes owner', 'mobilePosEnrollment', { userId: 'operator-b' }],
    ['PIN reset is pending', 'mobilePosEnrollment', { setupTokenHash: mobilePosHash(CLAIM) }],
    [
      'branch is paused',
      'mobilePosEnrollment',
      { branchSetup: { enabled: false, approvalRequired: true } },
    ],
    ['terminal changes owner', 'mobilePosTerminal', { assignedUserId: 'operator-b' }],
    ['terminal changes branch', 'mobilePosTerminal', { branchId: 'branch-b' }],
    [
      'terminal changes device',
      'mobilePosTerminal',
      { deviceSecretHash: mobilePosHash('b'.repeat(64)) },
    ],
  ])('rejects live binding change: %s', async (_reason, model, overrides) => {
    const f = fixture();
    const original = await f.prisma[model as string].findUnique();
    f.prisma[model as string].findUnique.mockResolvedValue({ ...original, ...overrides });
    const strategy = new JwtStrategy(
      f.config as any,
      f.prisma,
      { get: jest.fn(), set: jest.fn() } as any,
      f.audit as any,
    );
    await expect(
      strategy.validate({
        sub: 'operator-a',
        email: '',
        sid: 'session-a',
        tokenUse: 'mobile-pos',
        mobilePosEnrollmentId: 'enrollment-a',
        mobilePosTerminalId: 'terminal-a',
        mobilePosCredentialVersion: 1,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
