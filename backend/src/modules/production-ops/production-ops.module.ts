import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProductionOpsController } from './production-ops.controller';
import { ProductionOpsService } from './production-ops.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProductionOpsController],
  providers: [ProductionOpsService],
  exports: [ProductionOpsService],
})
export class ProductionOpsModule {}
