import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { FuelNozzleReadingsService } from './fuel-nozzle-readings.service';
import { UpdateNozzleReadingDto } from './dto/update-nozzle-reading.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('petroleum/fuel-nozzle-readings')
export class FuelNozzleReadingsController {
  constructor(private readonly service: FuelNozzleReadingsService) {}

  @Get()
  @RequirePermissions('fuel_readings.view')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('shiftId') shiftId?: string,
    @Query('nozzleId') nozzleId?: string,
    @Query('branchId') branchId?: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        shiftId,
        nozzleId,
        branchId,
        companyId,
        status,
      },
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('fuel_readings.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('fuel_readings.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNozzleReadingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }
}
