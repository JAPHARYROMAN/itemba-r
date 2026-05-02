import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CustomerCreditProfilesController } from './customer-credit-profiles.controller';
import { CustomerCreditProfilesService } from './customer-credit-profiles.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [CustomerCreditProfilesController],
  providers: [CustomerCreditProfilesService],
  exports: [CustomerCreditProfilesService],
})
export class CustomerCreditProfilesModule {}