import { Controller, Get, Param, Query, Request } from '@nestjs/common';
import { IntegrationEventsService } from './integration-events.service';
import { QueryIntegrationEventDto } from './dto/query-integration-event.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('integration-events')
export class IntegrationEventsController {
  constructor(private readonly service: IntegrationEventsService) {}

  @Get()
  @RequirePermissions('integration_events.view')
  findAll(@Query() query: QueryIntegrationEventDto, @Request() req: any, @CurrentUser() user: AuthUser) {
    const hasSensitive = (req.user?.permissions ?? []).includes('integration_events.sensitive.view');
    return this.service.findAll(query, hasSensitive, user);
  }

  @Get(':id')
  @RequirePermissions('integration_events.view')
  findOne(@Param('id') id: string, @Request() req: any) {
    const hasSensitive = (req.user?.permissions ?? []).includes('integration_events.sensitive.view');
    return this.service.findOne(id, hasSensitive);
  }
}
