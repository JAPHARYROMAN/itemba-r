import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PartyExistsService } from '../../common/services';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TasksController],
  providers: [TasksService, PartyExistsService],
  exports: [TasksService],
})
export class TasksModule {}
