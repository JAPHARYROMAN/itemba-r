import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SubcontractorsService } from './subcontractors.service';
import { SubcontractorsController } from './subcontractors.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [SubcontractorsService],
  controllers: [SubcontractorsController],
  exports: [SubcontractorsService],
})
export class SubcontractorsModule {}
