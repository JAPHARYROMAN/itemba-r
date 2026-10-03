import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PartyLinksController } from './party-links.controller';
import { PartyLinksService } from './party-links.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PartyLinksController],
  providers: [PartyLinksService, CompanyScopeService, OrganizationScopeService],
  exports: [PartyLinksService],
})
export class PartyLinksModule {}
