import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CcmNoticesController } from './ccm-notices.controller';
import { CcmNoticesService } from './ccm-notices.service';

@Module({
  imports: [PrismaModule],
  controllers: [CcmNoticesController],
  providers: [CcmNoticesService],
  exports: [CcmNoticesService],
})
export class CcmNoticesModule {}
