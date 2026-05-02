import { Controller, Delete, Get, Param, Post, Body, Query } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { QueryApiKeyDto } from './dto/query-api-key.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @RequirePermissions('api_keys.view')
  findAll(@Query() query: QueryApiKeyDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('api_keys.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('api_keys.create')
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Delete(':id/revoke')
  @RequirePermissions('api_keys.revoke')
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user);
  }
}
