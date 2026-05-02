import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxAutoApplyService } from './tax-auto-apply.service';
import { TaxAutoApplyController } from './tax-auto-apply.controller';

@Module({
  imports: [PrismaModule],
  providers: [TaxAutoApplyService],
  controllers: [TaxAutoApplyController],
  exports: [TaxAutoApplyService],
})
export class TaxAutoApplyModule {}
