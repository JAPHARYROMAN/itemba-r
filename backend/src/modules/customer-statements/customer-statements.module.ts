import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrintEngineModule } from '../print-engine/print-engine.module';
import { CompanyScopeService } from '../../common/services';
import { EmailService } from '../../common/services/email.service';
import { CustomerStatementsController } from './customer-statements.controller';
import { CustomerStatementsService } from './customer-statements.service';
import { CustomerAccountProjectionService } from './customer-account-projection.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, PrintEngineModule, ConfigModule],
  controllers: [CustomerStatementsController],
  providers: [
    CustomerStatementsService,
    CustomerAccountProjectionService,
    CompanyScopeService,
    OrganizationScopeService,
    EmailService,
  ],
  exports: [CustomerStatementsService, CustomerAccountProjectionService],
})
export class CustomerStatementsModule {}
