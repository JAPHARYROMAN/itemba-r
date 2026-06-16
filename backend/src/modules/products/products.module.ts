import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProfitModule } from '../profit/profit.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, ProfitModule],
  controllers: [ProductsController],
  providers: [ProductsService, CompanyScopeService],
  exports: [ProductsService],
})
export class ProductsModule {}
