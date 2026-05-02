import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ConstructionSitesService } from './construction-sites.service';
import { ConstructionSitesController } from './construction-sites.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [ConstructionSitesService],
  controllers: [ConstructionSitesController],
  exports: [ConstructionSitesService],
})
export class ConstructionSitesModule {}
