import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PartyBalanceModule } from '../party-balance/party-balance.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule, PartyBalanceModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, CompanyScopeService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
