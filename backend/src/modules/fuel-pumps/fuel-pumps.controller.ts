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
import { FuelPumpsService } from './fuel-pumps.service';
import { CreateFuelPumpDto } from './dto/create-fuel-pump.dto';
import { UpdateFuelPumpDto } from './dto/update-fuel-pump.dto';

@Controller('petroleum/fuel-pumps')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelPumpsController {
  constructor(private readonly service: FuelPumpsService) {}

  @Get('branch/:branchId')
  @RequirePermissions('fuel_pumps.view')
  findByBranch(@Param('branchId') branchId: string) {
    return this.service.findByBranch(branchId);
  }

  @Get()
  @RequirePermissions('fuel_pumps.view')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_pumps.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('fuel_pumps.manage')
  create(@Body() dto: CreateFuelPumpDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_pumps.manage')
  update(@Param('id') id: string, @Body() dto: UpdateFuelPumpDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('fuel_pumps.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
