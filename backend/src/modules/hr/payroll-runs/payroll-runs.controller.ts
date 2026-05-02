import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Patch } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PayrollRunsService } from './payroll-runs.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { UpdatePayrollRunDto } from './dto/update-payroll-run.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/payroll-runs')
export class PayrollRunsController {
  constructor(private readonly service: PayrollRunsService) {}

  @Get()
  @RequirePermissions('payroll.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('payroll.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('payroll.manage')
  create(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('payroll.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollRunDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/calculate')
  @RequirePermissions('payroll.calculate')
  calculate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.calculate(id, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('payroll.submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('payroll.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/pay')
  @RequirePermissions('payroll.pay')
  pay(
    @Param('id') id: string,
    @Body() body: { disbursingChartOfAccountId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.pay(id, user, body);
  }

  @Patch(':id/cancel')
  @RequirePermissions('payroll.cancel')
  cancel(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, body.reason, user);
  }

  @Delete(':id')
  @RequirePermissions('payroll.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
