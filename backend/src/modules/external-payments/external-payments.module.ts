import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ExternalPaymentsController } from './external-payments.controller';
import { ExternalPaymentsService } from './external-payments.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ExternalPaymentsController],
  providers: [ExternalPaymentsService],
  exports: [ExternalPaymentsService],
})
export class ExternalPaymentsModule {}
