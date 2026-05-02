import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { HelpArticlesController } from './help-articles.controller';
import { HelpArticlesService } from './help-articles.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [HelpArticlesController],
  providers: [HelpArticlesService],
  exports: [HelpArticlesService],
})
export class HelpArticlesModule {}
