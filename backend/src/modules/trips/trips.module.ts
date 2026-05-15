import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, SalesOrdersModule],
  providers: [TripsService, CompanyScopeService],
  controllers: [TripsController],
  exports: [TripsService],
})
export class TripsModule {}
