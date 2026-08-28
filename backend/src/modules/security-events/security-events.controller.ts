import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { SecurityEventsQueryDto } from '../../common/dto/resource-query.dto';
import { SecurityEventsService } from './security-events.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSecurityEventDto } from './dto/security-event.dto';

@Controller('security-events')
export class SecurityEventsController {
  constructor(private readonly service: SecurityEventsService) {}

  @Get()
  @RequirePermissions('security_events.view')
  findAll(@Query() query: SecurityEventsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('security_events.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('security_events.manage')
  create(@Body() dto: CreateSecurityEventDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id/review')
  @RequirePermissions('security_events.review')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.review(id, {}, user.id);
  }

  @Patch(':id/resolve')
  @RequirePermissions('security_events.resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, {}, user.id);
  }
}
