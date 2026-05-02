import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StatutoryReturnsController } from './statutory-returns.controller';
import { StatutoryReturnsService } from './statutory-returns.service';

@Module({
  imports: [PrismaModule],
  controllers: [StatutoryReturnsController],
  providers: [StatutoryReturnsService],
  exports: [StatutoryReturnsService],
})
export class StatutoryReturnsModule {}
