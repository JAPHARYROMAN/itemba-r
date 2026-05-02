import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PayrollPostingsService } from './payroll-postings.service';

@Module({
  imports: [PrismaModule],
  providers: [PayrollPostingsService],
  exports: [PayrollPostingsService],
})
export class PayrollPostingsModule {}
