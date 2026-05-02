import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { CreateDebtDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { QueryDebtDto } from './dto/query-debt.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SensitiveAccessInterceptor } from '../../common/interceptors/sensitive-access.interceptor';

@Controller('debts')
@UseInterceptors(SensitiveAccessInterceptor)
export class DebtsController {
  constructor(private readonly service: DebtsService) {}

  @Get('summary')
  @RequirePermissions('debts.read')
  getSummary(@CurrentUser() user: AuthUser) { return this.service.getSummary(user); }

  @Get('overdue')
  @RequirePermissions('debts.read')
  getOverdue(@CurrentUser() user: AuthUser) { return this.service.getOverdue(user); }

  @Get()
  @RequirePermissions('debts.read')
  findAll(@Query() query: QueryDebtDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('debts.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/audit-history')
  @RequirePermissions('debts.read')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  @Post()
  @RequirePermissions('debts.create')
  create(@Body() dto: CreateDebtDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('debts.update')
  update(@Param('id') id: string, @Body() dto: UpdateDebtDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('debts.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
