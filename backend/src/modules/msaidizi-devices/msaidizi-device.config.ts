import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MsaidiziDeviceConfig {
  constructor(private readonly config: ConfigService) {}

  get pairingEnabled(): boolean {
    return this.flag('MSAIDIZI_DEVICE_PAIRING_ENABLED');
  }

  get channelEnabled(): boolean {
    return this.flag('MSAIDIZI_DEVICE_CHANNEL_ENABLED');
  }

  get globalKillSwitchActive(): boolean {
    return this.flag('MSAIDIZI_GLOBAL_KILL_SWITCH');
  }

  get supervisorEnrollmentEnabled(): boolean {
    return this.flag('MSAIDIZI_SUPERVISOR_ENROLLMENT_ENABLED');
  }

  get pairingPepper(): string | null {
    return this.secret('MSAIDIZI_DEVICE_PAIRING_PEPPER');
  }

  get leasePepper(): string | null {
    return this.secret('MSAIDIZI_DEVICE_LEASE_PEPPER');
  }

  get supervisorEnrollmentPepper(): string | null {
    return this.secret('MSAIDIZI_SUPERVISOR_ENROLLMENT_PEPPER');
  }

  get reservedSupervisorIdentityDigests(): ReadonlySet<string> {
    return new Set(
      [
        this.nonEmpty('MSAIDIZI_EVALUATOR_CLIENT_CERT_SHA256'),
        this.nonEmpty('MSAIDIZI_EVALUATOR_CLIENT_SPKI_SHA256'),
        this.nonEmpty('MSAIDIZI_AUDIT_SIGNER_CLIENT_CERT_SHA256'),
        this.nonEmpty('MSAIDIZI_AUDIT_SIGNER_CLIENT_SPKI_SHA256'),
      ]
        .filter((value): value is string => value !== null)
        .map((value) => value.toUpperCase()),
    );
  }

  get signingKeyPath(): string | null {
    return this.nonEmpty('MSAIDIZI_ACTION_SIGNING_KEY_PATH');
  }

  get signingKeyId(): string | null {
    return this.nonEmpty('MSAIDIZI_ACTION_SIGNING_KEY_ID');
  }

  get tokenIssuer(): string {
    return this.config.get<string>('MSAIDIZI_ACTION_TOKEN_ISSUER', 'itemba-msaidizi-broker');
  }

  get tokenAudience(): string {
    return this.config.get<string>('MSAIDIZI_ACTION_TOKEN_AUDIENCE', 'itemba-windows-companion');
  }

  get tokenSubject(): string {
    return this.config.get<string>('MSAIDIZI_ACTION_TOKEN_SUBJECT', 'msaidizi-global');
  }

  get tokenTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_ACTION_TOKEN_TTL_SECONDS', 120, 30, 300);
  }

  get pairingTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_DEVICE_PAIRING_TTL_SECONDS', 300, 60, 600);
  }

  get supervisorEnrollmentTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_SUPERVISOR_ENROLLMENT_TTL_SECONDS', 300, 60, 900);
  }

  get leaseTtlSeconds(): number {
    return this.boundedInt('MSAIDIZI_DEVICE_LEASE_TTL_SECONDS', 90, 30, 600);
  }

  get redeliverySeconds(): number {
    return this.boundedInt('MSAIDIZI_DEVICE_REDELIVERY_SECONDS', 15, 5, 120);
  }

  get principalKey(): string {
    return this.config.get<string>('MSAIDIZI_AUTONOMY_PRINCIPAL_KEY', 'global-msaidizi');
  }

  pairingReady(): boolean {
    return this.pairingEnabled && this.pairingPepper !== null;
  }

  supervisorEnrollmentReady(): boolean {
    return this.supervisorEnrollmentEnabled && this.supervisorEnrollmentPepper !== null;
  }

  channelReady(): boolean {
    return (
      this.channelEnabled &&
      !this.globalKillSwitchActive &&
      this.leasePepper !== null &&
      this.signingKeyPath !== null &&
      this.signingKeyId !== null
    );
  }

  private flag(key: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(
      this.config.get<string>(key, 'false').trim().toLowerCase(),
    );
  }

  private secret(key: string): string | null {
    const value = this.nonEmpty(key);
    return value && value.length >= 32 ? value : null;
  }

  private nonEmpty(key: string): string | null {
    const value = this.config.get<string>(key, '').trim();
    return value.length > 0 ? value : null;
  }

  private boundedInt(key: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
  }
}
