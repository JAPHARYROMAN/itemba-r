import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { QueryWebhookEndpointDto } from './dto/query-webhook-endpoint.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('webhook-endpoints')
export class WebhookEndpointsController {
  constructor(private readonly service: WebhookEndpointsService) {}

  @Get()
  @RequirePermissions('webhook_endpoints.view')
  findAll(@Query() query: QueryWebhookEndpointDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('webhook_endpoints.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('webhook_endpoints.manage')
  create(@Body() dto: CreateWebhookEndpointDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('webhook_endpoints.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookEndpointDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('webhook_endpoints.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
