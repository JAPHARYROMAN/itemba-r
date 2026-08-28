import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import { PersistenceSecretGuard } from './persistence-secret-guard.service';

const UNSERIALIZABLE_LOG_CONTEXT = '[UNSERIALIZABLE LOG CONTEXT]';

/**
 * Process-wide Nest logger boundary. `app.useLogger()` installs this instance
 * behind every `new Logger(...)`, including Msaidizi worker/service loggers.
 */
@Injectable()
export class PersistenceSafeLoggerService extends ConsoleLogger {
  constructor(private readonly persistenceSecrets: PersistenceSecretGuard) {
    super();
  }

  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages.map((message) => sanitizeLogPayload(message, this.persistenceSecrets)),
      context === undefined ? undefined : this.persistenceSecrets.sanitizeText(context).value,
      logLevel,
      writeStreamType,
      sanitizeLogPayload(errorStack, this.persistenceSecrets),
    );
  }
}

export function sanitizeLogPayload(value: unknown, secrets: PersistenceSecretGuard): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return secrets.sanitizeText(value).value;
  if (value instanceof Error) return secrets.sanitizeText(value.stack ?? value.message).value;
  if (typeof value === 'object') {
    try {
      return secrets.sanitizeJson(value).value;
    } catch {
      return UNSERIALIZABLE_LOG_CONTEXT;
    }
  }
  return secrets.sanitizeText(String(value)).value;
}
