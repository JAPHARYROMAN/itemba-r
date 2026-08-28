import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CommunicationLogsQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CommunicationLogsService } from './communication-logs.service';
import { CreateCommunicationLogDto } from './dto/create-communication-log.dto';
import { UpdateCommunicationLogDto } from './dto/update-communication-log.dto';

@Controller('communication-logs')
export class CommunicationLogsController {
  constructor(private readonly service: CommunicationLogsService) {}

  @Get()
  @RequirePermissions('communication_logs.list')
  findAll(@Query() query: CommunicationLogsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('communication_logs.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('communication_logs.create')
  create(@Body() dto: CreateCommunicationLogDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('communication_logs.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommunicationLogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/close')
  @RequirePermissions('communication_logs.update')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }
}
