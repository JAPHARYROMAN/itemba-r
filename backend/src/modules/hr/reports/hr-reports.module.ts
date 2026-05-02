import { Module } from '@nestjs/common';
import { HrReportsController } from './hr-reports.controller';
import { HrReportsService } from './hr-reports.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [HrReportsController],
  providers: [HrReportsService],
})
export class HrReportsModule {}
