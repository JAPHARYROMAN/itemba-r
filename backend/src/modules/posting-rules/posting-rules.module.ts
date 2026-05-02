import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PostingRulesController } from './posting-rules.controller';
import { PostingRulesService } from './posting-rules.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PostingRulesController],
  providers: [PostingRulesService],
  exports: [PostingRulesService],
})
export class PostingRulesModule {}