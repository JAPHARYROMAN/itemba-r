import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { CustomerCreditProfilesController } from './customer-credit-profiles.controller';
import { CustomerCreditProfilesService } from './customer-credit-profiles.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerCreditProfilesController],
  providers: [CustomerCreditProfilesService, CompanyScopeService],
  exports: [CustomerCreditProfilesService],
})
export class CustomerCreditProfilesModule {}