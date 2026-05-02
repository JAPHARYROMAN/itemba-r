import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SavedReportViewsService } from './saved-report-views.service';
import { CreateSavedReportViewDto } from './dto/create-saved-report-view.dto';
import { UpdateSavedReportViewDto } from './dto/update-saved-report-view.dto';

@ApiTags('Saved Report Views')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/saved-report-views')
export class SavedReportViewsController {
  constructor(private readonly service: SavedReportViewsService) {}

  @Post()
  @RequirePermissions('saved_report_views.manage')
  create(@Body() dto: CreateSavedReportViewDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('saved_report_views.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('saved_report_views.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('saved_report_views.manage')
  update(@Param('id') id: string, @Body() dto: UpdateSavedReportViewDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/share')
  @RequirePermissions('saved_report_views.share')
  share(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.share(id, user);
  }

  @Patch(':id/set-default')
  @RequirePermissions('saved_report_views.manage')
  setDefault(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setDefault(id, user);
  }

  @Delete(':id')
  @RequirePermissions('saved_report_views.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
