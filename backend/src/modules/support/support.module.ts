import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SupportController],
  providers: [SupportService, CompanyScopeService],
  exports: [SupportService],
})
export class SupportModule {}
