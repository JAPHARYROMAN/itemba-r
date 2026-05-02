import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { QueryChartOfAccountDto } from './dto/query-chart-of-account.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('chart-of-accounts')
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @RequirePermissions('chart_of_accounts.view')
  findAll(@Query() query: QueryChartOfAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('company/:companyId')
  @RequirePermissions('chart_of_accounts.view')
  findByCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByCompany(companyId, user);
  }

  @Get(':id')
  @RequirePermissions('chart_of_accounts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('chart_of_accounts.manage')
  create(@Body() dto: CreateChartOfAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('chart_of_accounts.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateChartOfAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('chart_of_accounts.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
