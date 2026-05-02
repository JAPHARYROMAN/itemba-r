import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LoanRepaymentSchedulesService } from './loan-repayment-schedules.service';

@Controller('loan-repayment-schedules')
export class LoanRepaymentSchedulesController {
  constructor(private readonly service: LoanRepaymentSchedulesService) {}

  @Get()
  @RequirePermissions('loan_schedules.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('loan_schedules.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('loan_schedules.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post('generate/:loanId')
  @RequirePermissions('loan_schedules.create')
  generateForLoan(@Param('loanId') loanId: string, @CurrentUser() user: AuthUser) {
    return this.service.generateForLoan(loanId, user);
  }

  @Get(':id/payments')
  @RequirePermissions('loan_schedules.view')
  getPayments(@Param('id') id: string) {
    return this.service.getPayments(id);
  }

  @Post(':id/payments')
  @RequirePermissions('loan_schedules.pay')
  recordPayment(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.recordPayment(id, dto, user);
  }
}
