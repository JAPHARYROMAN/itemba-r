import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DisasterRecoveryController } from './disaster-recovery.controller';
import { DisasterRecoveryService } from './disaster-recovery.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DisasterRecoveryController],
  providers: [DisasterRecoveryService],
  exports: [DisasterRecoveryService],
})
export class DisasterRecoveryModule {}
