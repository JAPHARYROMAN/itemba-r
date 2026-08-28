import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import * as argon2 from 'argon2';
import { createE2eApp } from './e2e-app';
import { deleteAuditLogsForTest } from './audit-log-maintenance';

jest.setTimeout(60000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loginAs(app: INestApplication, email: string, password: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body?.data ?? res.body;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const TEST_EMAIL = `e2e-auth-${Date.now()}@itemba.local`;
  const LOCKOUT_EMAIL = `e2e-auth-lockout-${Date.now()}@itemba.local`;
  const TEST_PASS = 'TestPass123!';
  let testUserId: string;
  let lockoutUserId: string;

  async function resetUserAuthState(password = TEST_PASS) {
    const passwordHash = await argon2.hash(password);
    await prisma.refreshToken.deleteMany({ where: { userId: testUserId } });
    await prisma.activeSession.deleteMany({ where: { userId: testUserId } });
    await prisma.userSecurityProfile.deleteMany({ where: { userId: testUserId } });
    await prisma.user.update({
      where: { id: testUserId },
      data: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastPasswordVerifiedAt: null,
      },
    });
  }

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);

    const passwordHash = await argon2.hash(TEST_PASS);
    const user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        passwordHash,
        fullName: 'E2E Auth Test User',
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;

    const lockoutUser = await prisma.user.create({
      data: {
        email: LOCKOUT_EMAIL,
        passwordHash,
        fullName: 'E2E Auth Lockout User',
        status: 'ACTIVE',
      },
    });
    lockoutUserId = lockoutUser.id;
  }, 120000);

  afterAll(async () => {
    if (prisma && testUserId) {
      const userIds = [testUserId, lockoutUserId].filter(Boolean);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.twoFactorBackupCode.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userSecurityProfile.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.passwordHistory.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.activeSession.deleteMany({ where: { userId: { in: userIds } } });
      await deleteAuditLogsForTest(prisma, { userId: { in: userIds } });
      await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (app) await app.close();
  });

  // ─── A. Login ─────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('valid credentials return accessToken and refreshToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: TEST_EMAIL, password: TEST_PASS })
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.accessToken).toBeTruthy();
      expect(data.refreshToken).toBeTruthy();
      expect(data.tokenType).toBe('Bearer');
    });

    it('invalid password returns 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: TEST_EMAIL, password: 'WrongPassword!' })
        .expect(401);
    });

    it('unknown user returns 401 without revealing account existence', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody-exists@itemba.local', password: 'AnyPass123' })
        .expect(401);

      const msg = (res.body?.message ?? '').toLowerCase();
      expect(msg).not.toContain('not found');
      expect(msg).not.toContain('no account');
    });

    it('missing fields returns 400', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({}).expect(400);
    });

    it('invalid email format returns 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'pass' })
        .expect(400);
    });

    it('inactive user cannot login', async () => {
      await prisma.user.update({ where: { id: testUserId }, data: { status: 'INACTIVE' } });
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: TEST_EMAIL, password: TEST_PASS })
        .expect(401);
      await prisma.user.update({
        where: { id: testUserId },
        data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  // ─── B. Lockout ───────────────────────────────────────────────────────────

  describe('Account lockout', () => {
    beforeEach(async () => {
      // Clean slate before each lockout test
      await prisma.user.update({
        where: { id: lockoutUserId },
        data: { failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' },
      });
    });

    it('5 bad attempts lock the account', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: LOCKOUT_EMAIL, password: 'WrongPass!' });
      }

      const locked = await prisma.user.findUnique({ where: { id: lockoutUserId } });
      expect(locked?.lockedUntil).not.toBeNull();
      expect(locked?.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('locked account cannot login even with correct password', async () => {
      // Lock manually
      await prisma.user.update({
        where: { id: lockoutUserId },
        data: {
          failedLoginAttempts: 5,
          lockedUntil: new Date(Date.now() + 15 * 60_000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: LOCKOUT_EMAIL, password: TEST_PASS })
        .expect(401);
    });

    afterAll(async () => {
      if (!prisma || !lockoutUserId) return;
      // Ensure account is unlocked for subsequent tests
      await prisma.user.update({
        where: { id: lockoutUserId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  // ─── C. Logout ────────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('logout revokes refresh token so it cannot be reused', async () => {
      await resetUserAuthState();
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      expect(tokens.accessToken).toBeTruthy();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      // Revoked refresh token cannot refresh
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${tokens.refreshToken}`)
        .expect(401);
    });
  });

  // ─── D. Refresh Token Rotation ────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('valid refresh token issues new tokens and rotates', async () => {
      await resetUserAuthState();
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      const oldRefresh = tokens.refreshToken;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${oldRefresh}`)
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.accessToken).toBeTruthy();
      expect(data.refreshToken).toBeTruthy();
      expect(data.refreshToken).not.toBe(oldRefresh);
    });

    it('tolerates re-presenting a just-rotated refresh token within the rotation grace window', async () => {
      // REFRESH_TOKEN_ROTATION_GRACE_MS deliberately tolerates re-presenting a
      // just-rotated token: the web client drives several uncoordinated refresh
      // paths (proactive timers, the 401-retry, the proxy's own refresh), and a
      // tight window turned those benign concurrent refreshes into forced logouts.
      // Genuine theft protection — rejecting a token revoked for a NON-rotation
      // reason — is covered by the logout test above ("logout revokes refresh
      // token so it cannot be reused").
      await resetUserAuthState();
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      const oldRefresh = tokens.refreshToken;

      // Rotate once.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${oldRefresh}`)
        .expect(200);

      // Re-presented within the grace window: tolerated as a benign concurrent
      // refresh and still issues tokens, NOT treated as reuse/theft.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${oldRefresh}`)
        .expect(200);
    });
  });

  // ─── E. Protected Routes ──────────────────────────────────────────────────

  describe('Protected routes', () => {
    it('request without token is rejected', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('request with invalid token is rejected', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });

    it('request with valid access token succeeds', async () => {
      await resetUserAuthState();
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.email).toBe(TEST_EMAIL);
    });
  });

  // ─── F. Password Reset ───────────────────────────────────────────────────

  describe('Password Reset', () => {
    it('reset request returns generic message (no user enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/request')
        .send({ email: TEST_EMAIL })
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.message).toContain('If an account');
    });

    it('reset request for non-existing email returns the same message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/request')
        .send({ email: 'nobody-at-all@itemba.local' })
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.message).toContain('If an account');
    });

    it('invalid reset token is rejected', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/reset')
        .send({ token: 'invalid-token-xxx', newPassword: 'NewPass123!' })
        .expect(400);
    });

    it('valid reset token resets password and invalidates all sessions', async () => {
      await resetUserAuthState();

      // Get an active session
      const loginTokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      expect(loginTokens.accessToken).toBeTruthy();

      // Create a valid reset token
      const rawToken = 'e2e-test-token-' + Date.now();
      const tokenHash = await argon2.hash(rawToken);
      await prisma.passwordResetToken.create({
        data: { userId: testUserId, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/reset')
        .send({ token: rawToken, newPassword: 'NewTestPass456!' })
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.message).toContain('successfully');

      // Old refresh token must be revoked
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Authorization', `Bearer ${loginTokens.refreshToken}`)
        .expect(401);

      // Restore test password
      const restoredHash = await argon2.hash(TEST_PASS);
      await prisma.user.update({ where: { id: testUserId }, data: { passwordHash: restoredHash } });
    });

    it('expired reset token is rejected', async () => {
      const rawToken = 'expired-token-' + Date.now();
      const tokenHash = await argon2.hash(rawToken);
      await prisma.passwordResetToken.create({
        data: {
          userId: testUserId,
          tokenHash,
          expiresAt: new Date(Date.now() - 1000), // already expired
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/password-reset/reset')
        .send({ token: rawToken, newPassword: 'AnotherPass789!' })
        .expect(400);
    });
  });

  // ─── G. Verify Password (Recent Auth) ────────────────────────────────────

  describe('POST /auth/verify-password', () => {
    beforeEach(async () => {
      await resetUserAuthState();
    });

    it('correct password sets lastPasswordVerifiedAt', async () => {
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);
      expect(tokens.accessToken).toBeTruthy();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/verify-password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ password: TEST_PASS })
        .expect(200);

      const data = res.body?.data ?? res.body;
      expect(data.verified).toBe(true);

      const user = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(user?.lastPasswordVerifiedAt).not.toBeNull();
    });

    it('incorrect password returns 401', async () => {
      const tokens = await loginAs(app, TEST_EMAIL, TEST_PASS);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ password: 'WrongPassword999!' })
        .expect(401);
    });
  });
});
