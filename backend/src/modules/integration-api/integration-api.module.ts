import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExternalPaymentsModule } from '../external-payments/external-payments.module';
import { ExternalMessagesModule } from '../external-messages/external-messages.module';
import { WebhookEventsModule } from '../webhook-events/webhook-events.module';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { IntegrationApiController } from './integration-api.controller';

/**
 * Integration API surface — externally-facing routes authenticated by API key
 * with per-route scope enforcement.
 *
 * P0-09: Brings ApiKeyAuthGuard from theoretical (declared but unused) into
 * production use against real integration endpoints.
 */
@Module({
  imports: [
    PrismaModule,
    ExternalPaymentsModule,
    ExternalMessagesModule,
    WebhookEventsModule,
  ],
  controllers: [IntegrationApiController],
  providers: [ApiKeyAuthGuard],
})
export class IntegrationApiModule {}
