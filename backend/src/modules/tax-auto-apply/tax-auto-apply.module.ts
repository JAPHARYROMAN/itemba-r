import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CompanyScopeService } from '../../common/services';
import { TaxAutoApplyService } from './tax-auto-apply.service';
import { TaxAutoApplyController } from './tax-auto-apply.controller';

@Module({
  imports: [PrismaModule],
  providers: [TaxAutoApplyService, CompanyScopeService],
  controllers: [TaxAutoApplyController],
  exports: [TaxAutoApplyService],
})
export class TaxAutoApplyModule {}
