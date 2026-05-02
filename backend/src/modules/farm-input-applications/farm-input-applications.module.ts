import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { FarmInputApplicationsService } from './farm-input-applications.service';
import { FarmInputApplicationsController } from './farm-input-applications.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [FarmInputApplicationsService],
  controllers: [FarmInputApplicationsController],
  exports: [FarmInputApplicationsService],
})
export class FarmInputApplicationsModule {}
