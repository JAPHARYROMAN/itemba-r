import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ProjectMaterialIssuesService } from './project-material-issues.service';
import { ProjectMaterialIssuesController } from './project-material-issues.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ProjectMaterialIssuesService],
  controllers: [ProjectMaterialIssuesController],
  exports: [ProjectMaterialIssuesService],
})
export class ProjectMaterialIssuesModule {}
