import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProfitModule } from '../profit/profit.module';
import { DocumentsModule } from '../documents/documents.module';
import { CompanyScopeService } from '../../common/services';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, ProfitModule, DocumentsModule],
  controllers: [ProductsController],
  providers: [ProductsService, CompanyScopeService, OrganizationScopeService],
  exports: [ProductsService],
})
export class ProductsModule {}
