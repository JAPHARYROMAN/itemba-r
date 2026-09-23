/** Artifact-only process: no HTTP server, worker, model, companion or external delivery. */
import '../setup-env';
import { ConfigService } from '@nestjs/config';
import os from 'node:os';
import path from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PersistenceSecretGuard } from '../../src/common/services/persistence-secret-guard.service';
import { EphemeralSecretFingerprintRegistry } from '../../src/common/services/ephemeral-secret-fingerprint-registry.service';
import { AuditLogsService } from '../../src/modules/audit-logs/audit-logs.service';
import { MsaidiziArtifactsService } from '../../src/modules/msaidizi-artifacts/msaidizi-artifacts.service';
import {
  MsaidiziInputBindingError,
  resolveStepInputs,
} from '../../src/modules/msaidizi-tasks/msaidizi-input-bindings';

async function send(value: Record<string, unknown>) {
  await new Promise<void>((resolve, reject) =>
    process.send && process.connected
      ? process.send(value, (error) => (error ? reject(error) : resolve()))
      : reject(new Error('Fixture IPC unavailable')),
  );
}

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  const root = path.resolve(process.env.MSAIDIZI_ARTIFACT_PROOF_ROOT ?? '');
  if (
    process.env.MSAIDIZI_CHAT_DISPOSABLE_DB !== '1' ||
    database.hostname !== '127.0.0.1' ||
    !/^\/msaidizi_chat_proof_api(?:_[a-z0-9]+)?$/.test(database.pathname) ||
    path.dirname(root) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('msaidizi-artifact-proof-')
  )
    throw new Error(
      'Artifact fixture requires owned temporary storage and a loopback proof database',
    );
  const prisma = new PrismaService(
    new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
  );
  await prisma.$connect();
  const config = new ConfigService({
    MSAIDIZI_AUTONOMY_ENABLED: 'true',
    MSAIDIZI_ARTIFACT_ROOT: root,
    MSAIDIZI_ARTIFACT_ENCRYPTION_KEY: process.env.MSAIDIZI_ARTIFACT_PROOF_KEY,
  });
  const service = new MsaidiziArtifactsService(
    prisma,
    config,
    {} as never,
    new AuditLogsService(prisma),
  );
  let busy = false;
  process.on(
    'message',
    (message: { id: string; taskId: string; stepId: string; attemptId: string }) => {
      void (async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await resolveStepInputs(
            prisma,
            message.taskId,
            message.stepId,
            message.attemptId,
            (binding) => service.materializeForHostAction(binding),
          );
          await send({ id: message.id, ok: true, result });
        } catch (error) {
          await send({
            id: message.id,
            ok: false,
            code:
              error instanceof MsaidiziInputBindingError
                ? error.code
                : 'ARTIFACT_PREPARATION_REJECTED',
          });
        } finally {
          busy = false;
        }
      })();
    },
  );
  process.on('disconnect', () => {
    void prisma.$disconnect();
  });
  await send({ ready: true });
}
main().catch(() => {
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
