import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FuelCreditSalesService } from './fuel-credit-sales.service';
import { CreateFuelCreditSaleDto } from './dto/create-fuel-credit-sale.dto';
import { UpdateFuelCreditSaleDto } from './dto/update-fuel-credit-sale.dto';

@Controller('petroleum/fuel-credit-sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelCreditSalesController {
  constructor(private readonly service: FuelCreditSalesService) {}

  @Post()
  @RequirePermissions('fuel_credit_sales.create')
  create(@Body() dto: CreateFuelCreditSaleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('fuel_credit_sales.view')
  findAll(@Query() query: Record<string, string>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_credit_sales.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('fuel_credit_sales.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelCreditSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/mark-invoiced')
  @RequirePermissions('fuel_credit_sales.manage')
  markInvoiced(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markInvoiced(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('fuel_credit_sales.manage')
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.cancel(id, reason, user);
  }

  @Delete(':id')
  @RequirePermissions('fuel_credit_sales.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.softDelete(id, user);
  }
}
