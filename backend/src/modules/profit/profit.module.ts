import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { ProfitController } from './profit.controller';
import { ProfitService } from './profit.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProfitController],
  providers: [ProfitService, CompanyScopeService],
  exports: [ProfitService],
})
export class ProfitModule {}

