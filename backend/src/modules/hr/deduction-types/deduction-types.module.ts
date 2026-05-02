import { Module } from '@nestjs/common';
import { DeductionTypesController } from './deduction-types.controller';
import { DeductionTypesService } from './deduction-types.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [DeductionTypesController],
  providers: [DeductionTypesService],
  exports: [DeductionTypesService],
})
export class DeductionTypesModule {}
