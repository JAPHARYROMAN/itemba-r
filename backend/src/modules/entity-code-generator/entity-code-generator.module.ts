import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { EntityCodeGeneratorService } from './entity-code-generator.service';
import { SequenceBackfillService } from './sequence-backfill.service';
import { EntityCodeGeneratorController } from './entity-code-generator.controller';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

/**
 * Marked @Global so any service can inject the generator without each owning
 * module having to add it to its `imports` array. Code generation is a
 * cross-cutting concern; making it global keeps callers light.
 */
@Global()
@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [EntityCodeGeneratorService, SequenceBackfillService, CompanyScopeService],
  controllers: [EntityCodeGeneratorController],
  exports: [EntityCodeGeneratorService, SequenceBackfillService],
})
export class EntityCodeGeneratorModule {}
