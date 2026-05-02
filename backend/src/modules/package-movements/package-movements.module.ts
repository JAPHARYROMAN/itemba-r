import { Module } from '@nestjs/common';
import { PackageMovementsService } from './package-movements.service';
import { PackageMovementsController } from './package-movements.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [PackageMovementsController],
  providers: [PackageMovementsService],
  exports: [PackageMovementsService],
})
export class PackageMovementsModule {}
