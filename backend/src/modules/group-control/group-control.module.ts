import { Module } from '@nestjs/common';
import { GroupControlService } from './group-control.service';
import { GroupControlController } from './group-control.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService } from '../../common/services';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [GroupControlController],
  providers: [GroupControlService, CompanyScopeService],
})
export class GroupControlModule {}
