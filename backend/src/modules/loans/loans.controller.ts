import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { QueryLoanDto } from './dto/query-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { MarkLoanStatusDto } from './dto/mark-loan-status.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';

@Controller('loans')
@UseInterceptors(SensitiveAccessInterceptor)
export class LoansController {
  constructor(private readonly service: LoansService) {}

  @Get('summary')
  @RequirePermissions('loans.read')
  getSummary(@CurrentUser() user: AuthUser) { return this.service.getSummary(user); }

  @Get('upcoming-repayments')
  @RequirePermissions('loans.read')
  getUpcomingRepayments(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.service.getUpcomingRepayments(user, days ? parseInt(days, 10) : 30);
  }

  @Get('overdue')
  @RequirePermissions('loans.read')
  getOverdue(@CurrentUser() user: AuthUser) { return this.service.getOverdue(user); }

  @Get()
  @RequirePermissions('loans.read')
  findAll(@Query() query: QueryLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('loans.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/audit-history')
  @RequirePermissions('loans.read')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  @Post()
  @RequirePermissions('loans.create')
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('loans.update')
  update(@Param('id') id: string, @Body() dto: UpdateLoanDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/repayments')
  @RequirePermissions('loans.manage')
  recordRepayment(@Param('id') id: string, @Body() dto: RecordRepaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.recordRepayment(id, dto, user);
  }

  @Patch(':id/status')
  @RequirePermissions('loans.manage')
  markStatus(@Param('id') id: string, @Body() dto: MarkLoanStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.markStatus(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('loans.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
