import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SecurityPoliciesController } from './security-policies.controller';
import { SecurityPoliciesService } from './security-policies.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [SecurityPoliciesController],
  providers: [SecurityPoliciesService],
  exports: [SecurityPoliciesService],
})
export class SecurityPoliciesModule {}
