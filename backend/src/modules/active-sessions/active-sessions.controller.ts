import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ActiveSessionsQueryDto, PageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { ActiveSessionsService } from './active-sessions.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateActiveSessionDto, RevokeActiveSessionDto } from './dto/active-session-mutation.dto';

@Controller('active-sessions')
export class ActiveSessionsController {
  constructor(private readonly service: ActiveSessionsService) {}

  @Get()
  @RequirePermissions('active_sessions.view')
  findAll(@Query() query: ActiveSessionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('my')
  findMySessions(@CurrentUser() user: AuthUser, @Query() query: PageLimitQueryDto) {
    return this.service.findByUser(user.id, query, user);
  }

  @Get(':id')
  @RequirePermissions('active_sessions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('active_sessions.manage')
  create(@Body() dto: CreateActiveSessionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/revoke')
  @RequirePermissions('active_sessions.revoke')
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeActiveSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.revoke(id, dto, user);
  }
}
