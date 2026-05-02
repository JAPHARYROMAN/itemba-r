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
import { FuelDeliveriesService } from './fuel-deliveries.service';
import { CreateFuelDeliveryDto } from './dto/create-fuel-delivery.dto';
import { UpdateFuelDeliveryDto } from './dto/update-fuel-delivery.dto';

@Controller('petroleum/fuel-deliveries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelDeliveriesController {
  constructor(private readonly service: FuelDeliveriesService) {}

  @Post()
  @RequirePermissions('fuel_deliveries.create')
  create(@Body() dto: CreateFuelDeliveryDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('fuel_deliveries.view')
  findAll(@Query() query: Record<string, string>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_deliveries.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_deliveries.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelDeliveryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/receive')
  @RequirePermissions('fuel_deliveries.create')
  receive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.receive(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('fuel_deliveries.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/post')
  @RequirePermissions('fuel_deliveries.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('fuel_deliveries.approve')
  reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, reason, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('fuel_deliveries.create')
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.cancel(id, reason, user);
  }

  @Delete(':id')
  @RequirePermissions('fuel_deliveries.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.softDelete(id, user);
  }
}
