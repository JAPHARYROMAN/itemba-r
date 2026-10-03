import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { GeneratedDocumentsModule } from '../generated-documents/generated-documents.module';
import { PartyExistsService } from '../../common/services/party-exists.service';
@Module({
  imports: [PrismaModule, AuditLogsModule, GeneratedDocumentsModule],
  controllers: [RecordsController],
  providers: [RecordsService, CompanyScopeService, OrganizationScopeService, PartyExistsService],
})
export class RecordsModule {}
