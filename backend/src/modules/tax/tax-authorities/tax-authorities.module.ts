import { Module } from '@nestjs/common';
import { TaxAuthoritiesController } from './tax-authorities.controller';
import { TaxAuthoritiesService } from './tax-authorities.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [TaxAuthoritiesController],
  providers: [TaxAuthoritiesService],
  exports: [TaxAuthoritiesService],
})
export class TaxAuthoritiesModule {}
