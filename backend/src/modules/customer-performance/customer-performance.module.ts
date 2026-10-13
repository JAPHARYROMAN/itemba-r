import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerStatementsModule } from '../customer-statements/customer-statements.module';
import { CustomerPerformanceController } from './customer-performance.controller';
import { CustomerPerformanceService } from './customer-performance.service';

@Module({
  imports: [PrismaModule, CustomerStatementsModule],
  controllers: [CustomerPerformanceController],
  providers: [CustomerPerformanceService],
})
export class CustomerPerformanceModule {}
