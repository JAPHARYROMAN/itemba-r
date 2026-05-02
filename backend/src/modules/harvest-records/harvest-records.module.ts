import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HarvestRecordsService } from './harvest-records.service';
import { HarvestRecordsController } from './harvest-records.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [HarvestRecordsService],
  controllers: [HarvestRecordsController],
  exports: [HarvestRecordsService],
})
export class HarvestRecordsModule {}
