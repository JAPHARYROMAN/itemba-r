import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { UpsertCompanyProfileDto } from './dto/upsert-company-profile.dto';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}

  @Get()
  @RequirePermissions('companies.read')
  findAll(@Query() query: QueryCompanyDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('companies.read')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('companies.create')
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('companies.update')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('companies.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  // ── Legal Profile ──────────────────────────────────────────────────────────

  @Get(':id/profile')
  @RequirePermissions('company-profiles.read')
  getProfile(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getProfile(id, user);
  }

  @Put(':id/profile')
  @RequirePermissions('company-profiles.update')
  upsertProfile(@Param('id') id: string, @Body() dto: UpsertCompanyProfileDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertProfile(id, dto, user);
  }
}
