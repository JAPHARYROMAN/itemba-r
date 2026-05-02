import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RestaurantTablesService } from './restaurant-tables.service';
import { RestaurantTablesController } from './restaurant-tables.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RestaurantTablesService],
  controllers: [RestaurantTablesController],
  exports: [RestaurantTablesService],
})
export class RestaurantTablesModule {}
