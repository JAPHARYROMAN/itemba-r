import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { RestaurantOrdersController } from './restaurant-orders.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RestaurantOrdersService],
  controllers: [RestaurantOrdersController],
  exports: [RestaurantOrdersService],
})
export class RestaurantOrdersModule {}
