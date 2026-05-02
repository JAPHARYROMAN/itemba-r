import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RetentionPoliciesController } from './retention-policies.controller';
import { RetentionPoliciesService } from './retention-policies.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RetentionPoliciesController],
  providers: [RetentionPoliciesService],
  exports: [RetentionPoliciesService],
})
export class RetentionPoliciesModule {}
