import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { RfqsController } from './rfqs.controller';
import { RfqsService } from './rfqs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RfqsController],
  providers: [RfqsService, CompanyScopeService],
  exports: [RfqsService],
})
export class RfqsModule {}