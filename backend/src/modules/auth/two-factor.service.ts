import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { authenticator } from '@otplib/preset-default';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const APP_NAME = 'ITEMBA-R';
const BACKUP_CODE_COUNT = 8;

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  /** Step 1: Generate TOTP secret and return QR code URI. Does NOT enable 2FA yet. */
  async startSetup(userId: string): Promise<{ otpauthUrl: string; qrCodeDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    // Generate a new TOTP secret
    const secret = authenticator.generateSecret(20);

    // Encrypt secret before storing — bind ciphertext to userId so a copy of
    // one user's encrypted blob cannot be reused as another user's.
    const encryptedSecret = this.encryptSecret(secret, userId);

    // Ensure UserSecurityProfile exists
    await this.prisma.userSecurityProfile.upsert({
      where: { userId },
      create: { userId, twoFactorSecretEncrypted: encryptedSecret, twoFactorEnabled: false },
      update: { twoFactorSecretEncrypted: encryptedSecret, twoFactorEnabled: false },
    });

    const otpauthUrl = authenticator.keyuri(user.email, APP_NAME, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Return secret so user can manually enter it (never log or store raw in response cache)
    return { otpauthUrl, qrCodeDataUrl, secret };
  }

  /** Step 2: Verify TOTP code and enable 2FA. Returns backup codes (shown once). */
  async verifyAndEnable(
    userId: string,
    code: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ backupCodes: string[] }> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } });
    if (!profile?.twoFactorSecretEncrypted) {
      throw new BadRequestException('2FA setup not started. Call /auth/2fa/setup first.');
    }
    if (profile.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled.');
    }

    const secret = this.decryptSecret(profile.twoFactorSecretEncrypted, userId);
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) throw new UnauthorizedException('Invalid 2FA code');

    // Generate backup codes
    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase(),
    );

    // Store hashed backup codes
    await this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } });
    await this.prisma.twoFactorBackupCode.createMany({
      data: await Promise.all(
        rawCodes.map(async (c) => ({ userId, codeHash: await argon2.hash(c) })),
      ),
    });

    await this.prisma.userSecurityProfile.update({
      where: { userId },
      data: { twoFactorEnabled: true, twoFactorMethod: 'TOTP' },
    });

    await this.logSecurityEvent('TWO_FACTOR_ENABLED', userId, meta);
    await this.audit.log({
      action: 'TWO_FACTOR_ENABLED',
      entityType: 'User',
      entityId: userId,
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { backupCodes: rawCodes };
  }

  /** Verify a 2FA code (TOTP or backup code) during login challenge. */
  async verifyChallenge(
    userId: string,
    code: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<boolean> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } });
    if (!profile?.twoFactorEnabled || !profile.twoFactorSecretEncrypted) {
      throw new BadRequestException('2FA not enabled for this user');
    }

    // Try TOTP first
    const secret = this.decryptSecret(profile.twoFactorSecretEncrypted, userId);
    const totpValid = authenticator.verify({ token: code, secret });

    if (totpValid) {
      await this.logSecurityEvent('TWO_FACTOR_SUCCESS', userId, meta);
      return true;
    }

    // Try backup codes
    const unusedCodes = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId, usedAt: null },
    });

    for (const bc of unusedCodes) {
      if (await argon2.verify(bc.codeHash, code)) {
        // Mark backup code as used (single-use)
        await this.prisma.twoFactorBackupCode.update({
          where: { id: bc.id },
          data: { usedAt: new Date() },
        });
        await this.logSecurityEvent('TWO_FACTOR_SUCCESS', userId, meta);
        return true;
      }
    }

    await this.logSecurityEvent('TWO_FACTOR_FAILED', userId, meta);
    throw new UnauthorizedException('Invalid 2FA code');
  }

  /** Disable 2FA — requires a valid current TOTP code (recent-auth guard already checked password). */
  async disable(
    userId: string,
    totpCode: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } });
    if (!profile?.twoFactorEnabled || !profile.twoFactorSecretEncrypted) {
      throw new BadRequestException('2FA is not enabled');
    }

    const secret = this.decryptSecret(profile.twoFactorSecretEncrypted, userId);
    const isValid = authenticator.verify({ token: totpCode, secret });
    if (!isValid) throw new UnauthorizedException('Invalid 2FA code');

    await this.prisma.userSecurityProfile.update({
      where: { userId },
      data: {
        twoFactorEnabled: false,
        twoFactorMethod: 'NONE',
        twoFactorSecretEncrypted: null,
      },
    });

    await this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } });

    await this.logSecurityEvent('TWO_FACTOR_DISABLED', userId, meta);
    await this.audit.log({
      action: 'TWO_FACTOR_DISABLED',
      entityType: 'User',
      entityId: userId,
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  /** Check if user has 2FA enabled. */
  async isEnabled(userId: string): Promise<boolean> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } });
    return profile?.twoFactorEnabled ?? false;
  }

  /** Generate new backup codes — requires 2FA to be enabled. */
  async regenerateBackupCodes(
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ backupCodes: string[] }> {
    const profile = await this.prisma.userSecurityProfile.findUnique({ where: { userId } });
    if (!profile?.twoFactorEnabled) throw new BadRequestException('2FA is not enabled');

    const rawCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase(),
    );

    await this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } });
    await this.prisma.twoFactorBackupCode.createMany({
      data: await Promise.all(
        rawCodes.map(async (c) => ({ userId, codeHash: await argon2.hash(c) })),
      ),
    });

    await this.audit.log({
      action: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
      entityType: 'User',
      entityId: userId,
      userId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { backupCodes: rawCodes };
  }

  /**
   * P1-03 (cont.): Re-encrypt every TOTP secret stored in the legacy
   * unversioned AES-CBC format to the new versioned AES-GCM-with-AAD format.
   * Idempotent — already-v2 ciphertexts are skipped. Designed for one-shot
   * admin invocation after upgrading; does not alter functional state.
   */
  async reencryptLegacyTotpSecrets(): Promise<{
    scanned: number;
    migrated: number;
    skipped: number;
    failed: number;
  }> {
    const profiles = await this.prisma.userSecurityProfile.findMany({
      where: { twoFactorSecretEncrypted: { not: null } },
      select: { userId: true, twoFactorSecretEncrypted: true },
    });

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    for (const p of profiles) {
      const blob = p.twoFactorSecretEncrypted ?? '';
      if (blob.startsWith('v2:')) {
        skipped++;
        continue;
      }
      try {
        const plaintext = this.decryptSecret(blob, p.userId);
        const reencrypted = this.encryptSecret(plaintext, p.userId);
        await this.prisma.userSecurityProfile.update({
          where: { userId: p.userId },
          data: { twoFactorSecretEncrypted: reencrypted },
        });
        migrated++;
      } catch (err) {
        this.logger.error(
          `Failed to re-encrypt TOTP secret for userId=${p.userId}: ${(err as Error).message}`,
        );
        failed++;
      }
    }

    await this.audit.log({
      action: 'TWO_FACTOR_SECRETS_REENCRYPTED',
      entityType: 'UserSecurityProfile',
      severity: 'HIGH' as any,
      metadata: { scanned: profiles.length, migrated, skipped, failed } as any,
    });
    return { scanned: profiles.length, migrated, skipped, failed };
  }

  // ─── Encryption helpers ───────────────────────────────────────────────────
  //
  // P1-03: AES-256-GCM with userId as Additional Authenticated Data so a
  // copied ciphertext cannot be replayed against a different user's row.
  // Ciphertext is versioned (`v2:...`) so we can rotate keys/algorithms in
  // future without ambiguity. Legacy `iv:ct` AES-CBC ciphertexts written by
  // the previous implementation are decrypted in compatibility mode.

  private encryptSecret(secret: string, userId: string): string {
    const key = this.getTwoFactorKey();
    const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(userId, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v2:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptSecret(encrypted: string, userId: string): string {
    const key = this.getTwoFactorKey();
    const parts = encrypted.split(':');
    if (parts.length === 4 && parts[0] === 'v2') {
      const [, ivHex, authTagHex, encHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const enc = Buffer.from(encHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(userId, 'utf8'));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
    if (parts.length === 2) {
      // Legacy AES-CBC ciphertext from the previous implementation.
      const [ivHex, encHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const enc = Buffer.from(encHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
    throw new Error('Invalid 2FA ciphertext format');
  }

  private getTwoFactorKey(): Buffer {
    const secret = this.config.get<string>('TWO_FACTOR_ENCRYPTION_KEY');
    if (!secret || secret.length < 32) {
      throw new Error(
        'TWO_FACTOR_ENCRYPTION_KEY is required and must be at least 32 characters. ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    return crypto.createHash('sha256').update(secret).digest();
  }

  // ─── Security Event helper ───────────────────────────────────────────────

  private async logSecurityEvent(
    eventType: string,
    userId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      await this.prisma.securityEvent.create({
        data: {
          eventNumber: `SE-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          eventType: eventType as any,
          severity: 'MEDIUM',
          status: 'OPEN',
          userId,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      });
    } catch (err) {
      // Failure to persist a security event must surface — silent swallow hides
      // exactly the events ops need to see when something is wrong.
      this.logger.error(
        `Failed to persist 2FA SecurityEvent (eventType=${eventType}, userId=${userId})`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
