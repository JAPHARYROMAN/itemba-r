import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DataQualityService } from './data-quality.service';
import { CreateDataQualityIssueDto } from './dto/create-data-quality-issue.dto';

@ApiTags('Data Quality')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/data-quality')
export class DataQualityController {
  constructor(private readonly service: DataQualityService) {}

  @Post()
  @RequirePermissions('data_quality.manage')
  create(@Body() dto: CreateDataQualityIssueDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('data_quality.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get('summary')
  @RequirePermissions('data_quality.view')
  getSummary(@CurrentUser() user: AuthUser) {
    return this.service.getSummary(user);
  }

  @Post('run-checks')
  @RequirePermissions('data_quality.run_checks')
  runChecks(@CurrentUser() user: AuthUser) {
    return this.service.runChecks(user);
  }

  @Get(':id')
  @RequirePermissions('data_quality.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('data_quality.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDataQualityIssueDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/resolve')
  @RequirePermissions('data_quality.resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, user);
  }

  @Patch(':id/acknowledge')
  @RequirePermissions('data_quality.manage')
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.acknowledge(id, user);
  }

  @Patch(':id/dismiss')
  @RequirePermissions('data_quality.manage')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dismiss(id, user);
  }

  @Delete(':id')
  @RequirePermissions('data_quality.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
