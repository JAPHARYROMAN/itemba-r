import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RestoreTestsController } from './restore-tests.controller';
import { RestoreTestsService } from './restore-tests.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [RestoreTestsController],
  providers: [RestoreTestsService],
  exports: [RestoreTestsService],
})
export class RestoreTestsModule {}
