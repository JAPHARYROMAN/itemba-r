import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProjectProgressService } from './project-progress.service';
import { ProjectProgressController } from './project-progress.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ProjectProgressService],
  controllers: [ProjectProgressController],
  exports: [ProjectProgressService],
})
export class ProjectProgressModule {}
