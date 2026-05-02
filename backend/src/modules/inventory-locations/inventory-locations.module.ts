import { Module } from '@nestjs/common';
import { InventoryLocationsService } from './inventory-locations.service';
import { InventoryLocationsController } from './inventory-locations.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [InventoryLocationsController],
  providers: [InventoryLocationsService, CompanyScopeService],
  exports: [InventoryLocationsService],
})
export class InventoryLocationsModule {}
