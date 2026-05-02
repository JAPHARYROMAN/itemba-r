import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DataIsolationController } from './data-isolation.controller';
import { DataIsolationService } from './data-isolation.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DataIsolationController],
  providers: [DataIsolationService],
  exports: [DataIsolationService],
})
export class DataIsolationModule {}
