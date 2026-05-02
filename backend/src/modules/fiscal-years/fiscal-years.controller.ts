import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { UpdateFiscalYearDto } from './dto/update-fiscal-year.dto';
import { QueryFiscalYearDto } from './dto/query-fiscal-year.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('fiscal-years')
export class FiscalYearsController {
  constructor(private readonly service: FiscalYearsService) {}

  @Get()
  @RequirePermissions('fiscal_years.view')
  findAll(@Query() query: QueryFiscalYearDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('fiscal_years.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('fiscal_years.manage')
  create(@Body() dto: CreateFiscalYearDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('fiscal_years.manage')
  update(@Param('id') id: string, @Body() dto: UpdateFiscalYearDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/close')
  @RequirePermissions('fiscal_years.manage')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }

  @Patch(':id/lock')
  @RequirePermissions('fiscal_years.manage')
  lock(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.lock(id, user);
  }
}
