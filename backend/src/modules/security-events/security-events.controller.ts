import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { SecurityEventsService } from './security-events.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('security-events')
export class SecurityEventsController {
  constructor(private readonly service: SecurityEventsService) {}

  @Get()
  @RequirePermissions('security_events.view')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('security_events.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('security_events.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id/review')
  @RequirePermissions('security_events.review')
  review(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.review(id, dto, user.id);
  }

  @Patch(':id/resolve')
  @RequirePermissions('security_events.resolve')
  resolve(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, dto, user.id);
  }
}
