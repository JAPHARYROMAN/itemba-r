import { Module } from '@nestjs/common';
import { EphemeralSecretFingerprintRegistry } from './services/ephemeral-secret-fingerprint-registry.service';
import { PersistenceSecretGuard } from './services/persistence-secret-guard.service';
import { PersistenceSafeLoggerService } from './services/persistence-safe-logger.service';

/** One process-local registry shared by every explicitly importing Msaidizi boundary. */
@Module({
  providers: [
    EphemeralSecretFingerprintRegistry,
    PersistenceSecretGuard,
    PersistenceSafeLoggerService,
  ],
  exports: [
    EphemeralSecretFingerprintRegistry,
    PersistenceSecretGuard,
    PersistenceSafeLoggerService,
  ],
})
export class EphemeralSecretsModule {}
