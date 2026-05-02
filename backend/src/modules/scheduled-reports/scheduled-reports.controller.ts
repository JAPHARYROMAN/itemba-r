import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ScheduledReportsService } from './scheduled-reports.service';
import { CreateScheduledReportDto } from './dto/create-scheduled-report.dto';

@ApiTags('Scheduled Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly service: ScheduledReportsService) {}

  @Post()
  @RequirePermissions('scheduled_reports.manage')
  create(@Body() dto: CreateScheduledReportDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('scheduled_reports.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('scheduled_reports.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('scheduled_reports.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateScheduledReportDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/run')
  @RequirePermissions('scheduled_reports.run')
  run(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.run(id, user);
  }

  @Patch(':id/activate')
  @RequirePermissions('scheduled_reports.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.activate(id, user);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('scheduled_reports.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deactivate(id, user);
  }

  @Delete(':id')
  @RequirePermissions('scheduled_reports.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
