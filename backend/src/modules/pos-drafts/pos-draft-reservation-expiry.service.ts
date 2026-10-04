import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditChannel, Prisma } from '@prisma/client';
import { releaseExpiredPosReservations } from '../../common/services/pos-draft-reservations';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const SYSTEM_ACTOR = 'system:pos-draft-reservation-expiry';
const BATCH_SIZE = 100;
const SWEEP_INTERVAL_MS = 30_000;

type ExpiredBalance = {
  id: string;
  companyId: string;
  branchId: string;
  productId: string;
  quantityReserved: Prisma.Decimal;
};

/** Releases idle holds even when no phone or office user opens POS Draft. */
@Injectable()
export class PosDraftReservationExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PosDraftReservationExpiryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  onModuleInit(): void {
    const run = () => {
      void this.sweep().catch(() => {
        this.logger.error('POS reservation expiry failed; the next sweep will retry.');
      });
    };
    run();
    this.timer = setInterval(run, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Stock-first expiry never waits for a draft lock. Approval takes draft
      // then stock; mixing these lock orders in one transaction would deadlock.
      const due = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT b.id
          FROM inventory_balances b
          WHERE EXISTS (
            SELECT 1 FROM pos_draft_reservations r
            WHERE r."companyId" = b."companyId" AND r."branchId" = b."branchId"
              AND r."productId" = b."productId" AND r."releasedAt" IS NULL
              AND r."expiresAt" <= statement_timestamp()
          )
          ORDER BY b."companyId", b."branchId", b."productId"
          LIMIT ${BATCH_SIZE}
        `);
      for (const row of due) {
        try {
          await this.prisma.$transaction(
            async (tx) => {
              const balances = await tx.$queryRaw<ExpiredBalance[]>(Prisma.sql`
              SELECT id, "companyId", "branchId", "productId", "quantityReserved"
              FROM inventory_balances WHERE id = ${row.id} FOR UPDATE SKIP LOCKED
            `);
              if (balances[0]) await releaseExpiredPosReservations(tx, balances[0]);
            },
            { timeout: 15_000 },
          );
        } catch {
          // Keep a corrupt balance held for reconciliation without preventing
          // unrelated branches from releasing their own expired reservations.
          this.logger.error(`POS reservation balance ${row.id} could not expire; reconcile it.`);
        }
      }

      // A crash between these transactions is recoverable: every sweep also
      // finishes released drafts, independently of whether any holds remain due.
      await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM pos_drafts d
          WHERE status IN ('AWAITING_STOCKIST', 'READY_FINAL')
            AND "reservedUntil" <= statement_timestamp()
            AND NOT EXISTS (
              SELECT 1 FROM pos_draft_reservations r
              WHERE r."draftId" = d.id AND r."releasedAt" IS NULL
            )
          ORDER BY "reservedUntil", id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
        `);
          for (const row of rows) {
            const draft = await tx.posDraft.findUniqueOrThrow({ where: { id: row.id } });
            if (
              await tx.posDraftReservation.count({ where: { draftId: draft.id, releasedAt: null } })
            ) {
              continue;
            }
            const updated = await tx.posDraft.update({
              where: { id: draft.id },
              data: {
                revision: { increment: 1 },
                status: 'NEEDS_ATTENTION',
                reservedUntil: null,
                blockingReason: 'The 24 hour reservation expired. Approve and prepare stock again.',
              },
            });
            const metadata = {
              system: true,
              revision: updated.revision,
              originUserId: draft.originUserId,
              originRole: draft.originRole,
              requestId: draft.requestId,
            };
            await tx.posDraftDecision.create({
              data: {
                draftId: draft.id,
                revision: updated.revision,
                action: 'EXPIRE',
                actorUserId: SYSTEM_ACTOR,
                metadata,
              },
            });
            await this.audit.logStrictInTransaction(tx, {
              action: 'POS_DRAFT_EXPIRE',
              entityType: 'PosDraft',
              entityId: draft.id,
              companyId: draft.companyId,
              channel: AuditChannel.SYSTEM,
              principalType: 'SYSTEM',
              principalId: SYSTEM_ACTOR,
              metadata,
            });
          }
        },
        { timeout: 15_000 },
      );
    } finally {
      this.running = false;
    }
  }
}
