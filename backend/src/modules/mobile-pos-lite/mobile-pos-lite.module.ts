import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesOrdersModule } from '../sales-orders/sales-orders.module';
import { CompanyScopeService } from '../../common/services';
import { MobilePosLiteController } from './mobile-pos-lite.controller';
import { MobilePosLiteService } from './mobile-pos-lite.service';

@Module({
  imports: [AuditLogsModule, SalesOrdersModule],
  controllers: [MobilePosLiteController],
  providers: [MobilePosLiteService, CompanyScopeService],
  exports: [MobilePosLiteService],
})
export class MobilePosLiteModule {}
