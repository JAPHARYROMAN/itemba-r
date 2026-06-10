import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM field-level encryption for sensitive data at rest (integration
 * credentials, etc.).
 *
 * Hardening rules (P1-04):
 *   1. The encryption key is read from `APP_ENCRYPTION_KEY` and is required
 *      outside development. There is NO fallback to JWT signing secrets and
 *      NO literal default — sharing key material across security domains
 *      breaks rotation safety, and a literal default would silently ship.
 *   2. The key is derived once via scrypt with a fixed app-wide salt so the
 *      derived 32-byte symmetric key is deterministic across replicas while
 *      still benefiting from a slow KDF.
 *   3. Every ciphertext is versioned (`v1:`) so future key rotations can be
 *      identified and migrated.
 *   4. Authenticated encryption (GCM) is used for both confidentiality and
 *      tamper-detection.
 *
 * Operational notes:
 *   - Generate a key with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
 *   - In development, if `APP_ENCRYPTION_KEY` is unset the service refuses to
 *     boot. This is intentional — there is no path that lets a real secret
 *     accidentally encrypt with a weak default.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly version = 'v1';
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secret = this.config.get<string>('APP_ENCRYPTION_KEY');
    if (!secret) {
      throw new Error(
        'APP_ENCRYPTION_KEY is required. ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    if (secret.length < 32) {
      throw new Error('APP_ENCRYPTION_KEY must be at least 32 characters');
    }
    // scrypt salt — deterministic 32-byte key across replicas. The salt may be
    // overridden per-deployment via APP_ENCRYPTION_SALT; it defaults to the
    // original constant so existing ciphertext (keyed to that salt) still
    // decrypts. Changing APP_ENCRYPTION_SALT re-keys: only set it on a fresh
    // deployment or after re-encrypting all stored data.
    const salt = this.config.get<string>('APP_ENCRYPTION_SALT') || 'itemba-r-app-encryption-v1';
    this.key = crypto.scryptSync(secret, salt, 32);
  }

  /**
   * Encrypt a UTF-8 string. Returns `v1:<ivHex>:<authTagHex>:<ciphertextHex>`.
   * Throws when called before module init or when input is non-string.
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new TypeError('EncryptionService.encrypt expects a string');
    }
    if (!this.key) throw new Error('EncryptionService not initialized');
    const iv = crypto.randomBytes(12); // 96 bits — recommended GCM nonce length
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${this.version}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypt a string produced by {@link encrypt}. Throws on tampering or
   * unknown version. Backwards-compatible with the previous unversioned
   * `iv:tag:ct` format so existing rows still decrypt during migration.
   */
  decrypt(ciphertext: string): string {
    if (!this.key) throw new Error('EncryptionService not initialized');
    const parts = ciphertext.split(':');
    let ivHex: string;
    let authTagHex: string;
    let dataHex: string;
    if (parts.length === 4 && parts[0] === this.version) {
      [, ivHex, authTagHex, dataHex] = parts;
    } else if (parts.length === 3) {
      // Legacy unversioned ciphertext from the previous implementation.
      [ivHex, authTagHex, dataHex] = parts;
    } else {
      throw new Error('Invalid ciphertext format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  generateSecureToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  hmac(value: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
  }
}
