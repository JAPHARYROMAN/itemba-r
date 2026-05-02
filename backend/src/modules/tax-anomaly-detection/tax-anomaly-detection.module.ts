import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxAnomalyDetectionService } from './tax-anomaly-detection.service';
import { TaxAnomalyDetectionController } from './tax-anomaly-detection.controller';

@Module({
  imports: [PrismaModule],
  providers: [TaxAnomalyDetectionService],
  controllers: [TaxAnomalyDetectionController],
  exports: [TaxAnomalyDetectionService],
})
export class TaxAnomalyDetectionModule {}
