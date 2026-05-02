import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SalesCommissionsController } from './sales-commissions.controller';
import { SalesCommissionsService } from './sales-commissions.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SalesCommissionsController],
  providers: [SalesCommissionsService],
  exports: [SalesCommissionsService],
})
export class SalesCommissionsModule {}
