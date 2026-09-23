import { AuditChannel, AuditScopeKind, AuditSeverity, Prisma } from '@prisma/client';
import { MSAIDIZI_SERVICE_PRINCIPAL_TYPE } from '../../common/context/request-context';
import { AuditLogsService, redactSensitiveFields } from '../audit-logs/audit-logs.service';

/** Strict evidence must commit atomically with the attempt it describes. */
export async function auditErpAttemptResult(
  audit: AuditLogsService,
  tx: Prisma.TransactionClient,
  taskId: string,
  stepId: string,
  attemptId: string,
  outcome: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const task = await tx.msaidiziTask.findUnique({
    where: { id: taskId },
    select: { principalId: true, initiatedByUserId: true, mandateId: true, companyId: true },
  });
  if (!task) throw new Error('Msaidizi task disappeared while writing action evidence');
  await audit.logStrictInTransaction(tx, {
    action: `MSAIDIZI_ERP_ACTION_${outcome}`,
    entityType: 'MsaidiziToolAttempt',
    entityId: attemptId,
    userId: task.initiatedByUserId,
    companyId: task.companyId,
    scopeKind: task.companyId ? AuditScopeKind.COMPANY : AuditScopeKind.GROUP,
    newValue: redactSensitiveFields({ outcome, ...metadata }) as Prisma.InputJsonObject,
    severity: outcome === 'SUCCEEDED' ? AuditSeverity.LOW : AuditSeverity.HIGH,
    channel: AuditChannel.AGENT,
    agentSessionId: `task_${taskId.replace(/-/g, '')}`,
    principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
    principalId: task.principalId,
    mandateId: task.mandateId,
    initiatedByUserId: task.initiatedByUserId,
    taskId,
    stepId,
  });
}
