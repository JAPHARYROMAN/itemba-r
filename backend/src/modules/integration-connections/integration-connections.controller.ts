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

@Controller('integration-connections')
export class IntegrationConnectionsController {
  constructor(private readonly service: IntegrationConnectionsService) {}

  @Get()
  @RequirePermissions('integration_connections.view')
  findAll(@Query() query: QueryIntegrationConnectionDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('integration_connections.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('integration_connections.manage')
  create(@Body() dto: CreateIntegrationConnectionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('integration_connections.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationConnectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('integration_connections.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }

  @Post(':id/test')
  @RequirePermissions('integration_connections.test')
  test(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.testConnection(id, user.id);
  }
}
