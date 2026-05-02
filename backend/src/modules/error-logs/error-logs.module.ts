import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ErrorLogsController } from './error-logs.controller';
import { ErrorLogsService } from './error-logs.service';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ErrorLogsController],
  providers: [ErrorLogsService],
  exports: [ErrorLogsService],
})
export class ErrorLogsModule {}
