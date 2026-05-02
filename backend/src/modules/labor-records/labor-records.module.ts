import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LaborRecordsService } from './labor-records.service';
import { LaborRecordsController } from './labor-records.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [LaborRecordsService],
  controllers: [LaborRecordsController],
  exports: [LaborRecordsService],
})
export class LaborRecordsModule {}
