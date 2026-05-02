import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FuelPricesService } from './fuel-prices.service';
import { CreateFuelPriceDto } from './dto/create-fuel-price.dto';
import { UpdateFuelPriceDto } from './dto/update-fuel-price.dto';

@Controller('petroleum/fuel-prices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelPricesController {
  constructor(private readonly service: FuelPricesService) {}

  @Get('current')
  @RequirePermissions('fuel_prices.view')
  findCurrent(
    @Query('companyId') companyId?: string,
    @Query('branchId') branchId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.service.findCurrent({ companyId, branchId, productId });
  }

  @Get()
  @RequirePermissions('fuel_prices.view')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_prices.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('fuel_prices.manage')
  create(@Body() dto: CreateFuelPriceDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_prices.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelPriceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('fuel_prices.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('fuel_prices.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deactivate(id, user.id);
  }
}
