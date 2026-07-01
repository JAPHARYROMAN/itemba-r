import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { CustomerSegmentsController } from './customer-segments.controller';
import { CustomerSegmentsService } from './customer-segments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerSegmentsController],
  providers: [CustomerSegmentsService, CompanyScopeService],
  exports: [CustomerSegmentsService],
})
export class CustomerSegmentsModule {}