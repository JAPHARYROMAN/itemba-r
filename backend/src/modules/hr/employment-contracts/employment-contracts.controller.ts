import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Patch } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { EmploymentContractsService } from './employment-contracts.service';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/employment-contracts')
export class EmploymentContractsController {
  constructor(private readonly service: EmploymentContractsService) {}

  @Get()
  @RequirePermissions('employment_contracts.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('employment_contracts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('employment_contracts.create')
  create(@Body() dto: CreateEmploymentContractDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('employment_contracts.create')
  update(@Param('id') id: string, @Body() dto: UpdateEmploymentContractDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('employment_contracts.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/terminate')
  @RequirePermissions('employment_contracts.terminate')
  terminate(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser() user: AuthUser) {
    return this.service.terminate(id, body.reason, user);
  }

  @Delete(':id')
  @RequirePermissions('employment_contracts.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
