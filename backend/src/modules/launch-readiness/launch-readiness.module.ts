import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LaunchReadinessController } from './launch-readiness.controller';
import { LaunchReadinessService } from './launch-readiness.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LaunchReadinessController],
  providers: [LaunchReadinessService],
  exports: [LaunchReadinessService],
})
export class LaunchReadinessModule {}
