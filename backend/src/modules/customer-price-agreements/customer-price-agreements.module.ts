import { Module } from '@nestjs/common';
import { CustomerPriceAgreementsService } from './customer-price-agreements.service';
import { CustomerPriceAgreementsController } from './customer-price-agreements.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerPriceAgreementsController],
  providers: [CustomerPriceAgreementsService],
  exports: [CustomerPriceAgreementsService],
})
export class CustomerPriceAgreementsModule {}
