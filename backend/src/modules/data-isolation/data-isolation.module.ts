import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataIsolationController } from './data-isolation.controller';
import { DataIsolationService } from './data-isolation.service';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataIsolationController],
  providers: [DataIsolationService, CompanyScopeService],
  exports: [DataIsolationService],
})
export class DataIsolationModule {}
