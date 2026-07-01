import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PrintEngineModule } from '../print-engine/print-engine.module';
import { CompanyScopeService } from '../../common/services';
import { EmailService } from '../../common/services/email.service';
import { CustomerStatementsController } from './customer-statements.controller';
import { CustomerStatementsService } from './customer-statements.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, PrintEngineModule, ConfigModule],
  controllers: [CustomerStatementsController],
  providers: [CustomerStatementsService, CompanyScopeService, EmailService],
  exports: [CustomerStatementsService],
})
export class CustomerStatementsModule {}
