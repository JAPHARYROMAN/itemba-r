import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DisbursementsController } from './disbursements.controller';
import { DisbursementsService } from './disbursements.service';

@Module({
  imports: [PrismaModule],
  controllers: [DisbursementsController],
  providers: [DisbursementsService],
  exports: [DisbursementsService],
})
export class DisbursementsModule {}
