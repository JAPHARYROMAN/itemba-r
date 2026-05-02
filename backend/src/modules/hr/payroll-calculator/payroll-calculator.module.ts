import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PayrollCalculatorService } from './payroll-calculator.service';

@Module({
  imports: [PrismaModule],
  providers: [PayrollCalculatorService],
  exports: [PayrollCalculatorService],
})
export class PayrollCalculatorModule {}
