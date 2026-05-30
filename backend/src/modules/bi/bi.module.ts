import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { BiController } from './bi.controller';
import { BiService } from './bi.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [BiController],
  providers: [BiService, CompanyScopeService],
  exports: [BiService],
})
export class BiModule {}
