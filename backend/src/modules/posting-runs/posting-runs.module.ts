import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { PostingRunsController } from './posting-runs.controller';
import { PostingRunsService } from './posting-runs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PostingRunsController],
  providers: [PostingRunsService, CompanyScopeService],
  exports: [PostingRunsService],
})
export class PostingRunsModule {}
