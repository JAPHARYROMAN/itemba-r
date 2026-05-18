import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { ThreeWayMatchingController } from './three-way-matching.controller';
import { ThreeWayMatchingService } from './three-way-matching.service';

// PostingEngineService is provided by the @Global AccountingEngineModule.
@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ThreeWayMatchingController],
  providers: [ThreeWayMatchingService, CompanyScopeService, AccountResolverService],
  exports: [ThreeWayMatchingService],
})
export class ThreeWayMatchingModule {}
