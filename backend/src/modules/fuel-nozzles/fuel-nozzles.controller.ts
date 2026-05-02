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
import { FuelNozzlesService } from './fuel-nozzles.service';
import { CreateFuelNozzleDto } from './dto/create-fuel-nozzle.dto';
import { UpdateFuelNozzleDto } from './dto/update-fuel-nozzle.dto';

@Controller('petroleum/fuel-nozzles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelNozzlesController {
  constructor(private readonly service: FuelNozzlesService) {}

  @Get('pump/:pumpId')
  @RequirePermissions('fuel_nozzles.view')
  findByPump(@Param('pumpId') pumpId: string) {
    return this.service.findByPump(pumpId);
  }

  @Get('branch/:branchId')
  @RequirePermissions('fuel_nozzles.view')
  findByBranch(@Param('branchId') branchId: string) {
    return this.service.findByBranch(branchId);
  }

  @Get()
  @RequirePermissions('fuel_nozzles.view')
  findAll(@Query() query: Record<string, unknown>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_nozzles.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('fuel_nozzles.manage')
  create(@Body() dto: CreateFuelNozzleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_nozzles.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuelNozzleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('fuel_nozzles.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
