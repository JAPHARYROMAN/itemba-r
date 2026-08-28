import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { LoanRepaymentSchedulesQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LoanRepaymentSchedulesService } from './loan-repayment-schedules.service';
import {
  CreateLoanRepaymentScheduleDto,
  RecordLoanRepaymentDto,
} from './dto/loan-repayment-schedule-mutation.dto';

@Controller('loan-repayment-schedules')
export class LoanRepaymentSchedulesController {
  constructor(private readonly service: LoanRepaymentSchedulesService) {}

  @Get()
  @RequirePermissions('loan_schedules.list')
  findAll(@Query() query: LoanRepaymentSchedulesQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('loan_schedules.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
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

  @Get(':id/payments')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('loan_schedules.view')
  getPayments(@Param('id') id: string) {
    return this.service.getPayments(id);
  }

  @Post(':id/payments')
  @RequirePermissions('loan_schedules.pay')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordLoanRepaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordPayment(id, dto, user);
  }
}
