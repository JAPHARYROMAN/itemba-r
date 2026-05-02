import { Module } from '@nestjs/common';
import { TaxTypesController } from './tax-types.controller';
import { TaxTypesService } from './tax-types.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxTypesController],
  providers: [TaxTypesService],
  exports: [TaxTypesService],
})
export class TaxTypesModule {}
