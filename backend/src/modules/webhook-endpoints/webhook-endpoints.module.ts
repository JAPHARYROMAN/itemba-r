import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [WebhookEndpointsController],
  providers: [WebhookEndpointsService, CompanyScopeService],
  exports: [WebhookEndpointsService],
})
export class WebhookEndpointsModule {}
