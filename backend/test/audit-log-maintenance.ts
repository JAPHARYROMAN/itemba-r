import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Test-only cleanup for isolated/disposable databases.
 *
 * Production application code has no delete API and the database rejects
 * audit mutations. Tests run as the migration owner, so they may disable only
 * the two named append-only triggers inside the same transaction as cleanup.
 * Any failure rolls the trigger changes back with the delete.
 */
export async function deleteAuditLogsForTest(
  prisma: Pick<PrismaClient, '$transaction'>,
  where: Prisma.AuditLogWhereInput,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "audit_log_company_scopes" DISABLE TRIGGER "audit_log_company_scopes_append_only_guard"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_append_only_guard"',
    );
    const deleted = await tx.auditLog.deleteMany({ where });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_append_only_guard"',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "audit_log_company_scopes" ENABLE TRIGGER "audit_log_company_scopes_append_only_guard"',
    );
    return deleted.count;
  });
}
