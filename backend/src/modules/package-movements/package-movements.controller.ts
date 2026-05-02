import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PackageMovementsService } from './package-movements.service';
import { CreatePackageMovementDto } from './dto/create-package-movement.dto';
import { QueryPackageMovementDto } from './dto/query-package-movement.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/package-movements')
@Controller('westsides/package-movements')
export class PackageMovementsController {
  constructor(private readonly service: PackageMovementsService) {}

  @Post()
  @RequirePermissions('package_movements.manage')
  @ApiOperation({ summary: 'Create package movement' })
  create(@Body() dto: CreatePackageMovementDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('package_movements.view')
  @ApiOperation({ summary: 'List package movements' })
  findAll(@Query() query: QueryPackageMovementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('balances/customer/:customerId')
  @RequirePermissions('package_movements.view')
  @ApiOperation({ summary: 'Get customer package balances' })
  findBalancesByCustomer(@Param('customerId') customerId: string) {
    return this.service.findBalancesByCustomer(customerId);
  }

  @Get('customer/:customerId')
  @RequirePermissions('package_movements.view')
  @ApiOperation({ summary: 'All movements for a customer' })
  findByCustomer(@Param('customerId') customerId: string) {
    return this.service.findByCustomer(customerId);
  }

  @Get(':id')
  @RequirePermissions('package_movements.view')
  @ApiOperation({ summary: 'Get package movement by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
