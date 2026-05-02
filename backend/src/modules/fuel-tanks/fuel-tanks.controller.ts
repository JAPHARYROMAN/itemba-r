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
import { FuelTanksService } from './fuel-tanks.service';
import { CreateFuelTankDto } from './dto/create-fuel-tank.dto';
import { UpdateFuelTankDto } from './dto/update-fuel-tank.dto';

@Controller('petroleum/fuel-tanks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelTanksController {
  constructor(private readonly service: FuelTanksService) {}

  @Get('branch/:branchId')
  @RequirePermissions('fuel_tanks.view')
  findByBranch(@Param('branchId') branchId: string) {
    return this.service.findByBranch(branchId);
  }

  @Get()
  @RequirePermissions('fuel_tanks.view')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_tanks.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('fuel_tanks.manage')
  create(@Body() dto: CreateFuelTankDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_tanks.manage')
  update(@Param('id') id: string, @Body() dto: UpdateFuelTankDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('fuel_tanks.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
