import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LeaseAgreementsService } from './lease-agreements.service';
import { LeaseAgreementsController } from './lease-agreements.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [LeaseAgreementsService],
  controllers: [LeaseAgreementsController],
  exports: [LeaseAgreementsService],
})
export class LeaseAgreementsModule {}
