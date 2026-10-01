import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { ReopenFuelReportDto, SaveFuelReportDto } from '../fuel-reporting/fuel-reporting.dto';
import { PetroDollarService } from './petrodollar.service';

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
  constructor(private readonly service: PetroDollarService) {}

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
}
