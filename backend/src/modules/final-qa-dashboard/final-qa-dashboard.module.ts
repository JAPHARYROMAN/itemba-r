import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FinalQaDashboardController } from './final-qa-dashboard.controller';
import { FinalQaDashboardService } from './final-qa-dashboard.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [FinalQaDashboardController],
  providers: [FinalQaDashboardService],
  exports: [FinalQaDashboardService],
})
export class FinalQaDashboardModule {}
