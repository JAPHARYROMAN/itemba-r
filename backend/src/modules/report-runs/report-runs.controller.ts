import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ReportRunsService } from './report-runs.service';
import { CreateReportRunDto } from './dto/create-report-run.dto';

@ApiTags('Report Runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/report-runs')
export class ReportRunsController {
  constructor(private readonly service: ReportRunsService) {}

  @Post()
  @RequirePermissions('report_runs.create')
  create(@Body() dto: CreateReportRunDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('report_runs.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('report_runs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Get(':id/results')
  @RequirePermissions('report_runs.view')
  getResults(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getResults(id, user);
  }

  @Post(':id/export')
  @RequirePermissions('sensitive_reports.export')
  export(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.export(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('report_runs.view')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }
}
