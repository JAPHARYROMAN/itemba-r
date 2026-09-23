import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { LoanRepaymentSchedulesQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LoanRepaymentSchedulesService } from './loan-repayment-schedules.service';
import { LoanLifecycleService } from '../loans/loan-lifecycle.service';
import {
  CreateLoanRepaymentScheduleDto,
  RecordLoanRepaymentDto,
} from './dto/loan-repayment-schedule-mutation.dto';

@Controller('loan-repayment-schedules')
export class LoanRepaymentSchedulesController {
  constructor(
    private readonly service: LoanRepaymentSchedulesService,
    private readonly lifecycle: LoanLifecycleService,
  ) {}

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Get(':id/payment-preview')
  @AgentExcluded()
  @RequirePermissions('loan_schedules.view')
  preview(@Param('id') id: string, @Query('amount') amount: string, @CurrentUser() user: AuthUser) {
    return this.lifecycle.previewScheduled(id, amount, user);
  }

  @Get()
  @RequirePermissions('loan_schedules.list')
  findAll(@Query() query: LoanRepaymentSchedulesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  // The ITEMBA OS redesign (4a155f19) moved this read onto actor-scoped loan
  // access; it stays agent-excluded (fail closed) until that contract has been
  // reviewed and has positive evidence.
  @Get(':id')
  @AgentExcluded()
  @RequirePermissions('loan_schedules.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('loan_schedules.create')
  create(@Body() dto: CreateLoanRepaymentScheduleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post('generate/:loanId')
  @RequirePermissions('loan_schedules.create')
  generateForLoan(@Param('loanId') loanId: string, @CurrentUser() user: AuthUser) {
    return this.service.generateForLoan(loanId, user);
  }

  // The ITEMBA OS redesign (4a155f19) moved this read onto actor-scoped loan
  // access; it stays agent-excluded (fail closed) until that contract has been
  // reviewed and has positive evidence.
  @Get(':id/payments')
  @AgentExcluded()
  @RequirePermissions('loan_schedules.view')
  getPayments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getPayments(id, user);
  }

  // The ITEMBA OS redesign (4a155f19) re-routed this money movement through a
  // Cash Desk account with a new request contract; the prior agent evidence no
  // longer applies, so it stays agent-excluded (fail closed) until re-reviewed.
  @Post(':id/payments')
  @AgentExcluded()
  @RequirePermissions('loan_schedules.pay')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordLoanRepaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordPayment(id, dto, user);
  }
}
