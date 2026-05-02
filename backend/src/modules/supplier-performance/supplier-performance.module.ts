import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SupplierPerformanceController } from './supplier-performance.controller';
import { SupplierPerformanceService } from './supplier-performance.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupplierPerformanceController],
  providers: [SupplierPerformanceService],
  exports: [SupplierPerformanceService],
})
export class SupplierPerformanceModule {}