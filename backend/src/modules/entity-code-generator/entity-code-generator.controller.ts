import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SequenceBackfillService } from './sequence-backfill.service';

/**
 * Admin endpoints for the entity-code generator. The `next()` API itself is
 * service-only — services inject and call directly. This controller exposes
 * only the one-shot operational helpers.
 *
 * `POST /entity-code-generator/backfill?companyId=<optional>` aligns each
 * `DocumentNumberSequence.currentNumber` with the highest-already-issued
 * trailing-counter found across existing entity rows. Run once after
 * deploying the central generator so the next emitted code can't collide
 * with legacy data.
 */
@Controller('entity-code-generator')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EntityCodeGeneratorController {
  constructor(private readonly backfill: SequenceBackfillService) {}

  @Post('backfill')
  @RequirePermissions('doc_sequences.update')
  runBackfill(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.backfill.backfillAll(user, { companyId });
  }
}
