import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BidComparisonsController } from './bid-comparisons.controller';
import { BidComparisonsService } from './bid-comparisons.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BidComparisonsController],
  providers: [BidComparisonsService],
  exports: [BidComparisonsService],
})
export class BidComparisonsModule {}