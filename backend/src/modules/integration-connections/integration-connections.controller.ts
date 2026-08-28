import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { IntegrationConnectionsService } from './integration-connections.service';
import { CreateIntegrationConnectionDto } from './dto/create-integration-connection.dto';
import { UpdateIntegrationConnectionDto } from './dto/update-integration-connection.dto';
import { QueryIntegrationConnectionDto } from './dto/query-integration-connection.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

@Controller('integration-connections')
export class IntegrationConnectionsController {
  constructor(private readonly service: IntegrationConnectionsService) {}

  @Get()
  @RequirePermissions('integration_connections.view')
  findAll(@Query() query: QueryIntegrationConnectionDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('integration_connections.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('integration_connections.manage')
  create(@Body() dto: CreateIntegrationConnectionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('integration_connections.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('integration_connections.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/test')
  @AgentExcluded('external_egress_not_represented')
  @RequirePermissions('integration_connections.test')
  test(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.testConnection(id, user);
  }
}
