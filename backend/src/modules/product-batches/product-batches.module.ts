import { Module } from '@nestjs/common';
import { ProductBatchesService } from './product-batches.service';
import { ProductBatchesController } from './product-batches.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ProductBatchesController],
  providers: [ProductBatchesService, CompanyScopeService],
  exports: [ProductBatchesService],
})
export class ProductBatchesModule {}
