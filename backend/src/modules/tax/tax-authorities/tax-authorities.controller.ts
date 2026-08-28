import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TaxAuthoritiesQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { TaxAuthoritiesService } from './tax-authorities.service';
import { CreateTaxAuthorityDto } from './dto/create-tax-authority.dto';
import { UpdateTaxAuthorityDto } from './dto/update-tax-authority.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/authorities')
export class TaxAuthoritiesController {
  constructor(private readonly service: TaxAuthoritiesService) {}

  @Get()
  @RequirePermissions('tax_authorities.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TaxAuthoritiesQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tax_authorities.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('tax_authorities.manage')
  create(@Body() dto: CreateTaxAuthorityDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_authorities.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaxAuthorityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_authorities.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
