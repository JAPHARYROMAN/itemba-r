import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EquipmentUsageService } from './equipment-usage.service';
import { EquipmentUsageController } from './equipment-usage.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [EquipmentUsageService],
  controllers: [EquipmentUsageController],
  exports: [EquipmentUsageService],
})
export class EquipmentUsageModule {}
