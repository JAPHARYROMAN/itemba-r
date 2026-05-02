import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DepreciationService } from './depreciation.service';

@Controller('depreciation')
export class DepreciationController {
  constructor(private readonly service: DepreciationService) {}

  @Get()
  @RequirePermissions('depreciation.list')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('depreciation.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('depreciation.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get(':scheduleId/entries')
  @RequirePermissions('depreciation.view')
  getEntries(@Param('scheduleId') scheduleId: string) {
    return this.service.getEntries(scheduleId);
  }

  @Post(':scheduleId/entries')
  @RequirePermissions('depreciation.create')
  addEntry(@Param('scheduleId') scheduleId: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.addEntry(scheduleId, dto, user);
  }

  @Post(':scheduleId/generate')
  @RequirePermissions('depreciation.create')
  generateEntries(
    @Param('scheduleId') scheduleId: string,
    @Body() body: { months?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.generateEntries(scheduleId, body?.months ?? 12, user);
  }

  @Post('entries/:id/post')
  @RequirePermissions('depreciation.post_entry')
  postEntry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.postEntry(id, user);
  }
}
