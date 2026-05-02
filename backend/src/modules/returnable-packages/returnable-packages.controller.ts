import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReturnablePackagesService } from './returnable-packages.service';
import { CreateReturnablePackageDto } from './dto/create-returnable-package.dto';
import { UpdateReturnablePackageDto } from './dto/update-returnable-package.dto';
import { QueryReturnablePackageDto } from './dto/query-returnable-package.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/returnable-packages')
@Controller('westsides/returnable-packages')
export class ReturnablePackagesController {
  constructor(private readonly service: ReturnablePackagesService) {}

  @Post()
  @RequirePermissions('returnable_packages.manage')
  @ApiOperation({ summary: 'Create returnable package' })
  create(@Body() dto: CreateReturnablePackageDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('returnable_packages.view')
  @ApiOperation({ summary: 'List returnable packages' })
  findAll(@Query() query: QueryReturnablePackageDto) {
    return this.service.findAll(query);
  }

  @Get('balances')
  @RequirePermissions('returnable_packages.view')
  @ApiOperation({ summary: 'List customer package balances' })
  getBalances(@Query() query: QueryReturnablePackageDto) {
    return this.service.getBalances(query);
  }

  @Get(':id')
  @RequirePermissions('returnable_packages.view')
  @ApiOperation({ summary: 'Get returnable package by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('returnable_packages.manage')
  @ApiOperation({ summary: 'Update returnable package' })
  update(@Param('id') id: string, @Body() dto: UpdateReturnablePackageDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('returnable_packages.manage')
  @ApiOperation({ summary: 'Soft delete returnable package' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
