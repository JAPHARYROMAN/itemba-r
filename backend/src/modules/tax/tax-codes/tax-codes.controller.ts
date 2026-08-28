import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TaxCodesQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { TaxCodesService } from './tax-codes.service';
import { CreateTaxCodeDto } from './dto/create-tax-code.dto';
import { UpdateTaxCodeDto } from './dto/update-tax-code.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/codes')
export class TaxCodesController {
  constructor(private readonly service: TaxCodesService) {}

  @Get()
  @RequirePermissions('tax_codes.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TaxCodesQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tax_codes.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tax_codes.manage')
  create(@Body() dto: CreateTaxCodeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_codes.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTaxCodeDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_codes.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
