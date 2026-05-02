import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RentalPropertiesService } from './rental-properties.service';
import { RentalPropertiesController } from './rental-properties.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [RentalPropertiesService],
  controllers: [RentalPropertiesController],
  exports: [RentalPropertiesService],
})
export class RentalPropertiesModule {}
