import { Module } from '@nestjs/common';
import { AuditEvidencePacksController } from './audit-evidence-packs.controller';
import { AuditEvidencePacksService } from './audit-evidence-packs.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AuditEvidencePacksController],
  providers: [AuditEvidencePacksService],
  exports: [AuditEvidencePacksService],
})
export class AuditEvidencePacksModule {}
