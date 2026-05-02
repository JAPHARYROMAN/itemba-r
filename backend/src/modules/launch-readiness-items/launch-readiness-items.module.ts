import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LaunchReadinessItemsController } from './launch-readiness-items.controller';
import { LaunchReadinessItemsService } from './launch-readiness-items.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [LaunchReadinessItemsController],
  providers: [LaunchReadinessItemsService],
  exports: [LaunchReadinessItemsService],
})
export class LaunchReadinessItemsModule {}
