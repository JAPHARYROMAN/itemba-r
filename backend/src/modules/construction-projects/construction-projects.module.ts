import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ConstructionProjectsService } from './construction-projects.service';
import { ConstructionProjectsController } from './construction-projects.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ConstructionProjectsService],
  controllers: [ConstructionProjectsController],
  exports: [ConstructionProjectsService],
})
export class ConstructionProjectsModule {}
