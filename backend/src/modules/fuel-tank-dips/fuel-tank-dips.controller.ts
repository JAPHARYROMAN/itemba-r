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
import { FuelTankDipsService } from './fuel-tank-dips.service';
import { CreateFuelTankDipDto } from './dto/create-fuel-tank-dip.dto';
import { UpdateFuelTankDipDto } from './dto/update-fuel-tank-dip.dto';

@Controller('petroleum/tank-dips')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelTankDipsController {
  constructor(private readonly service: FuelTankDipsService) {}

  @Post()
  @RequirePermissions('tank_dips.create')
  create(@Body() dto: CreateFuelTankDipDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('tank_dips.view')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('tank_dips.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('tank_dips.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelTankDipDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/submit')
  @RequirePermissions('tank_dips.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user.id);
  }

  @Patch(':id/approve')
  @RequirePermissions('tank_dips.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Patch(':id/reject')
  @RequirePermissions('tank_dips.approve')
  reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, user.id, reason);
  }

  @Patch(':id/post')
  @RequirePermissions('tank_dips.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user.id);
  }

  @Delete(':id')
  @RequirePermissions('tank_dips.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
