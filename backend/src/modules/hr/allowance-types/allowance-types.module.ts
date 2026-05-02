import { Module } from '@nestjs/common';
import { AllowanceTypesController } from './allowance-types.controller';
import { AllowanceTypesService } from './allowance-types.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [AllowanceTypesController],
  providers: [AllowanceTypesService],
  exports: [AllowanceTypesService],
})
export class AllowanceTypesModule {}
