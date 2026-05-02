import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrintEngineController } from './print-engine.controller';
import { PrintEngineService } from './print-engine.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PrintEngineController],
  providers: [PrintEngineService],
  exports: [PrintEngineService],
})
export class PrintEngineModule {}