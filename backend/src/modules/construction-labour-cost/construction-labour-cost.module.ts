import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConstructionLabourCostController } from './construction-labour-cost.controller';
import { ConstructionLabourCostService } from './construction-labour-cost.service';

@Module({
  imports: [PrismaModule],
  controllers: [ConstructionLabourCostController],
  providers: [ConstructionLabourCostService],
  exports: [ConstructionLabourCostService],
})
export class ConstructionLabourCostModule {}
