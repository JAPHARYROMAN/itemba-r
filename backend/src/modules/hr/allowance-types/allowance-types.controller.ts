import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SearchCompanyPageLimitQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { AllowanceTypesService } from './allowance-types.service';
import { CreateAllowanceTypeDto } from './dto/create-allowance-type.dto';
import { UpdateAllowanceTypeDto } from './dto/update-allowance-type.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/allowance-types')
export class AllowanceTypesController {
  constructor(private readonly service: AllowanceTypesService) {}

  @Get()
  @RequirePermissions('allowances.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: SearchCompanyPageLimitQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('allowances.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('allowances.manage')
  create(@Body() dto: CreateAllowanceTypeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('allowances.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAllowanceTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('allowances.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
