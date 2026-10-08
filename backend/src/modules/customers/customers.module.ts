import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CustomerStatementsModule } from '../customer-statements/customer-statements.module';
import { PartyBalanceModule } from '../party-balance/party-balance.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, PartyBalanceModule, CustomerStatementsModule],
  controllers: [CustomersController],
  providers: [CustomersService, CompanyScopeService],
  exports: [CustomersService],
})
export class CustomersModule {}
