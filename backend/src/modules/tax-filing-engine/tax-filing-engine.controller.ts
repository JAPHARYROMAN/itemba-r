import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TaxFilingEngineService } from './tax-filing-engine.service';

/**
 * Tax filing engine — Sprint C3.
 *
 * `POST /compute/:periodId` aggregates source data (TaxTransaction ledger,
 * payroll lines, GL postings) into a draft TaxReturn for the given filing
 * period. Refuses to overwrite returns already in SUBMITTED/PAID/APPROVED/
 * CLOSED status.
 *
 * `GET /preview/:periodId` returns the same figures without persisting —
 * useful for the "what would this period look like?" question.
 */
@Controller('tax-filing-engine')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxFilingEngineController {
  constructor(private readonly service: TaxFilingEngineService) {}

  @Get('preview/:periodId')
  @RequirePermissions('finance.reports.view')
  preview(@Param('periodId') periodId: string) {
    return this.service.previewReturn(periodId);
  }

  @Post('compute/:periodId')
  @RequirePermissions('finance.reports.view')
  compute(@Param('periodId') periodId: string, @CurrentUser() user: AuthUser) {
    return this.service.computeReturn(periodId, user.id);
  }
}
