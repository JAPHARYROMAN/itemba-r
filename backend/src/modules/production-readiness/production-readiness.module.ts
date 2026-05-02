import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProductionReadinessController } from './production-readiness.controller';
import { ProductionReadinessService } from './production-readiness.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProductionReadinessController],
  providers: [ProductionReadinessService],
  exports: [ProductionReadinessService],
})
export class ProductionReadinessModule {}
