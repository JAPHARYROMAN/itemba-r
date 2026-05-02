import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CropSeasonsService } from './crop-seasons.service';
import { CropSeasonsController } from './crop-seasons.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [CropSeasonsService],
  controllers: [CropSeasonsController],
  exports: [CropSeasonsService],
})
export class CropSeasonsModule {}
