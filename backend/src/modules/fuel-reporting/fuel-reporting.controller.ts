import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { FuelReportingService } from './fuel-reporting.service';
import {
  CreateReportingPumpDto,
  CreateReportingTankDto,
  CreateReportingStationDto,
  ReportingStationDetailsDto,
  ReopenFuelReportDto,
  SaveFuelReportDto,
} from './fuel-reporting.dto';

@ApiTags('fuel-reporting')
@ApiBearerAuth()
@Controller('fuel-reporting')
export class FuelReportingController {
  constructor(private readonly service: FuelReportingService) {}
  @Get('stations')
  @RequirePermissions('fuel_reporting.admin')
  stations(@CurrentUser() user: AuthUser) {
    return this.service.stations(user);
  }
  @Post('stations')
  @RequirePermissions('fuel_reporting.admin')
  createStation(@CurrentUser() user: AuthUser, @Body() dto: CreateReportingStationDto) {
    return this.service.createStation(user, dto);
  }
  @Post('stations/:id/update')
  @RequirePermissions('fuel_reporting.admin')
  updateStation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReportingStationDetailsDto,
  ) {
    return this.service.updateStation(user, id, dto);
  }
  @Post('stations/:id/deactivate')
  @RequirePermissions('fuel_reporting.admin')
  deactivateStation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setStationActive(user, id, false);
  }
  @Post('stations/:id/restore')
  @RequirePermissions('fuel_reporting.admin')
  restoreStation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.setStationActive(user, id, true);
  }
  @Get('bootstrap')
  @RequirePermissions('fuel_reporting.read')
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.service.bootstrap(user);
  }
  @Get('workspace')
  @RequirePermissions('fuel_reporting.read')
  workspace(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId: string,
    @Query('businessDate') businessDate: string,
    @Query('shift') shift: string,
  ) {
    return this.service.workspace(user, branchId, businessDate, shift);
  }
  @Get('history')
  @RequirePermissions('fuel_reporting.read')
  history(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId: string,
    @Query('before') before?: string,
  ) {
    return this.service.history(user, branchId, before);
  }
  @Get('reports/:id/revisions')
  @RequirePermissions('fuel_reporting.read')
  revisions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revisions(user, id);
  }
  @Post('reports')
  @RequirePermissions('fuel_reporting.manage')
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveFuelReportDto) {
    return this.service.save(user, dto);
  }
  @Post('reports/:id/reopen')
  @RequirePermissions('fuel_reporting.manage')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReopenFuelReportDto) {
    return this.service.reopen(user, id, dto);
  }
  @Post('pumps')
  @RequirePermissions('fuel_reporting.admin')
  createPump(@CurrentUser() user: AuthUser, @Body() dto: CreateReportingPumpDto) {
    return this.service.createPump(user, dto);
  }
  @Post('pumps/:id/deactivate')
  @RequirePermissions('fuel_reporting.admin')
  deactivatePump(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deactivatePump(user, id);
  }
  @Post('tanks')
  @RequirePermissions('fuel_reporting.admin')
  createTank(@CurrentUser() user: AuthUser, @Body() dto: CreateReportingTankDto) {
    return this.service.createTank(user, dto);
  }
}
