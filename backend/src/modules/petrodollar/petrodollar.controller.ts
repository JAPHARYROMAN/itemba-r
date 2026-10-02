import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import {
  CreateReportingStationDto,
  ReportingStationDetailsDto,
  CreateReportingPumpDto,
  CreateReportingTankDto,
  ReopenFuelReportDto,
  SaveFuelReportDto,
  ReportingConfigurationRevisionDto,
  UpdateReportingTankDto,
  UpdateReportingPumpDto,
} from '../fuel-reporting/fuel-reporting.dto';
import { PetroDollarService } from './petrodollar.service';
import { PetroDollarPostingService } from './petrodollar-posting.service';
import { PostPetroDollarDto, ReversePetroDollarDto } from './petrodollar-posting.dto';

/**
 * Mwanjalisi-only station operations for the PetroDollar OS app. It reuses the Fuel
 * Reporting permissions and engine. `@AgentExcluded` keeps every route out of Msaidizi's
 * tool registry (fail closed) until it has been reviewed for agent eligibility.
 */
@ApiTags('petrodollar')
@ApiBearerAuth()
@Controller('petrodollar')
@AgentExcluded()
export class PetroDollarController {
  constructor(
    private readonly service: PetroDollarService,
    private readonly posting: PetroDollarPostingService,
  ) {}

  @Get('reports/:id/posting')
  @RequirePermissions(
    'fuel_reporting.read',
    'journal_entries.view',
    'sales_desk.view',
    'cash_desk.view',
    'customers.view',
    'inventory.view',
  )
  postingReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.posting.review(user, id);
  }

  @Post('reports/:id/posting')
  @RequirePermissions('fuel_reporting.manage', 'journal_entries.create', 'journal_entries.post')
  postShift(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostPetroDollarDto,
  ) {
    return this.posting.post(user, id, dto);
  }

  @Post('reports/:id/posting/reverse')
  @RequirePermissions('fuel_reporting.manage', 'journal_entries.reverse')
  reversePosting(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePetroDollarDto,
  ) {
    return this.posting.reverse(user, id, dto);
  }

  @Get('bootstrap')
  @RequirePermissions('fuel_reporting.read')
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.service.bootstrap(user);
  }

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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportingStationDetailsDto,
  ) {
    return this.service.updateStation(user, id, dto);
  }

  @Post('stations/:id/deactivate')
  @RequirePermissions('fuel_reporting.admin')
  deactivateStation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setStationActive(user, id, false);
  }

  @Post('stations/:id/restore')
  @RequirePermissions('fuel_reporting.admin')
  restoreStation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setStationActive(user, id, true);
  }

  @Post('pumps')
  @RequirePermissions('fuel_reporting.admin')
  createPump(@CurrentUser() user: AuthUser, @Body() dto: CreateReportingPumpDto) {
    return this.service.createPump(user, dto);
  }

  @Post('pumps/:id/deactivate')
  @RequirePermissions('fuel_reporting.admin')
  deactivatePump(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deactivatePump(user, id);
  }

  @Post('tanks')
  @RequirePermissions('fuel_reporting.admin')
  createTank(@CurrentUser() user: AuthUser, @Body() dto: CreateReportingTankDto) {
    return this.service.createTank(user, dto);
  }

  @Patch('tanks/:id')
  @RequirePermissions('fuel_reporting.admin')
  updateTank(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportingTankDto,
  ) {
    return this.service.updateTank(user, id, dto);
  }

  @Delete('tanks/:id')
  @RequirePermissions('fuel_reporting.admin')
  deleteTank(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportingConfigurationRevisionDto,
  ) {
    return this.service.deleteTank(user, id, dto);
  }

  @Post('tanks/:id/restore')
  @RequirePermissions('fuel_reporting.admin')
  restoreTank(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportingConfigurationRevisionDto,
  ) {
    return this.service.restoreTank(user, id, dto);
  }

  @Patch('pumps/:id')
  @RequirePermissions('fuel_reporting.admin')
  updatePump(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportingPumpDto,
  ) {
    return this.service.updatePump(user, id, dto);
  }

  @Delete('pumps/:id')
  @RequirePermissions('fuel_reporting.admin')
  deletePump(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportingConfigurationRevisionDto,
  ) {
    return this.service.deletePump(user, id, dto);
  }

  @Post('pumps/:id/restore')
  @RequirePermissions('fuel_reporting.admin')
  restorePump(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportingConfigurationRevisionDto,
  ) {
    return this.service.restorePump(user, id, dto);
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
}
