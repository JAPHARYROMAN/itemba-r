import { Module } from '@nestjs/common';
import { FuelReportingModule } from '../fuel-reporting/fuel-reporting.module';
import { PetroDollarController } from './petrodollar.controller';
import { PetroDollarService } from './petrodollar.service';

@Module({
  imports: [FuelReportingModule],
  controllers: [PetroDollarController],
  providers: [PetroDollarService],
})
export class PetroDollarModule {}
