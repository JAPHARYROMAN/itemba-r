import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { WebhookEventsController } from './webhook-events.controller';
import { WebhookEventControlService } from './webhook-event-control.service';
import { WebhookEventsService } from './webhook-events.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [WebhookEventsController],
  providers: [WebhookEventsService, WebhookEventControlService, CompanyScopeService],
  exports: [WebhookEventsService],
})
export class WebhookEventsModule {}
