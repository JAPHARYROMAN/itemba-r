import { Module } from '@nestjs/common';
import { CompanyTaxRegistrationsController } from './company-tax-registrations.controller';
import { CompanyTaxRegistrationsService } from './company-tax-registrations.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CompanyTaxRegistrationsController],
  providers: [CompanyTaxRegistrationsService],
  exports: [CompanyTaxRegistrationsService],
})
export class CompanyTaxRegistrationsModule {}
