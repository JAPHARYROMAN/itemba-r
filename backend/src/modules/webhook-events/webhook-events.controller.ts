import { Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { WebhookEventsService } from './webhook-events.service';
import { QueryWebhookEventDto } from './dto/query-webhook-event.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('webhook-events')
export class WebhookEventsController {
  constructor(private readonly service: WebhookEventsService) {}

  @Get()
  @RequirePermissions('webhook_events.view')
  findAll(
    @Query() query: QueryWebhookEventDto,
    @Request() req: any,
    @CurrentUser() user: AuthUser,
  ) {
    const hasSensitive = (req.user?.permissions ?? []).includes('webhook_events.sensitive.view');
    return this.service.findAll(query, hasSensitive, user);
  }

  @Get(':id')
  @RequirePermissions('webhook_events.view')
  findOne(@Param('id') id: string, @Request() req: any, @CurrentUser() user: AuthUser) {
    const hasSensitive = (req.user?.permissions ?? []).includes('webhook_events.sensitive.view');
    return this.service.findOne(id, hasSensitive, user);
  }

  @Post(':id/reprocess')
  @RequirePermissions('webhook_events.reprocess')
  reprocess(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reprocess(id, user);
  }
}
