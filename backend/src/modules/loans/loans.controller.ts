import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { QueryLoanDto } from './dto/query-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { MarkLoanStatusDto } from './dto/mark-loan-status.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';
import { SensitiveAccess } from '../../common/decorators/sensitive-access.decorator';
import { LoanLifecycleService } from './loan-lifecycle.service';
import { ReverseLoanEventDto } from './dto/reverse-loan-event.dto';

@Controller('loans')
@SensitiveAccess('Loans')
@UseInterceptors(SensitiveAccessInterceptor)
export class LoansController {
  constructor(
    private readonly service: LoansService,
    private readonly lifecycle: LoanLifecycleService,
  ) {}

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Get('accounting-options')
  @AgentExcluded()
  @RequirePermissions('cash_desk.view', 'journal_entries.view')
  accountingOptions(@Query('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.lifecycle.options(user, companyId);
  }

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Get(':id/financial')
  @AgentExcluded()
  @RequirePermissions('loans.read', 'journal_entries.view', 'cash_desk.view')
  financial(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.lifecycle.review(id, user);
  }

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Post(':id/financial/:eventId/reverse')
  @AgentExcluded()
  @RequirePermissions('loans.manage', 'journal_entries.reverse')
  reverseEvent(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
    @Body() dto: ReverseLoanEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lifecycle.reverse(id, eventId, dto, user);
  }

  @Get('summary')
  @RequirePermissions('loans.read')
  getSummary(@CurrentUser() user: AuthUser) {
    return this.service.getSummary(user);
  }

  @Get('upcoming-repayments')
  @RequirePermissions('loans.read')
  getUpcomingRepayments(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.service.getUpcomingRepayments(user, days ? parseInt(days, 10) : 30);
  }

  @Get('overdue')
  @RequirePermissions('loans.read')
  getOverdue(@CurrentUser() user: AuthUser) {
    return this.service.getOverdue(user);
  }

  @Get()
  @RequirePermissions('loans.read')
  findAll(@Query() query: QueryLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('loans.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/audit-history')
  @AgentExcluded('read_writes_audit_ledger')
  @RequirePermissions('loans.read')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  // The ITEMBA OS redesign (4a155f19) re-routed this money movement through a
  // Cash Desk account with a new request contract; the prior agent evidence no
  // longer applies, so it stays agent-excluded (fail closed) until re-reviewed.
  @Post()
  @AgentExcluded()
  @RequirePermissions('loans.create')
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('loans.update')
  update(@Param('id') id: string, @Body() dto: UpdateLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  // The ITEMBA OS redesign (4a155f19) re-routed this money movement through a
  // Cash Desk account with a new request contract; the prior agent evidence no
  // longer applies, so it stays agent-excluded (fail closed) until re-reviewed.
  @Post(':id/repayments')
  @AgentExcluded()
  @RequirePermissions('loans.manage')
  recordRepayment(
    @Param('id') id: string,
    @Body() dto: RecordRepaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordRepayment(id, dto, user);
  }

  @Patch(':id/status')
  @RequirePermissions('loans.manage')
  markStatus(
    @Param('id') id: string,
    @Body() dto: MarkLoanStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.markStatus(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('loans.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
