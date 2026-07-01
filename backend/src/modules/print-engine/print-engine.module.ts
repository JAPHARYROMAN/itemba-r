import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrintEngineController } from './print-engine.controller';
import { PrintEngineService } from './print-engine.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PrintEngineController],
  providers: [PrintEngineService, CompanyScopeService],
  exports: [PrintEngineService],
})
export class PrintEngineModule {}