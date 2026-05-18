import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { RentPaymentsService } from './rent-payments.service';
import { RentPaymentsController } from './rent-payments.controller';

// PostingEngineService comes from the @Global AccountingEngineModule.
@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentPaymentsService, AccountResolverService],
  controllers: [RentPaymentsController],
  exports: [RentPaymentsService],
})
export class RentPaymentsModule {}
