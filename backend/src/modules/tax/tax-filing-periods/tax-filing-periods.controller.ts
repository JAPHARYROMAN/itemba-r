import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { TaxFilingPeriodsService } from './tax-filing-periods.service';
import { CreateTaxFilingPeriodDto } from './dto/create-tax-filing-period.dto';
import { UpdateTaxFilingPeriodDto } from './dto/update-tax-filing-period.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/filing-periods')
export class TaxFilingPeriodsController {
  constructor(private readonly service: TaxFilingPeriodsService) {}

  @Get()
  @RequirePermissions('tax_filing_periods.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tax_filing_periods.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tax_filing_periods.manage')
  create(@Body() dto: CreateTaxFilingPeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_filing_periods.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTaxFilingPeriodDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_filing_periods.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
