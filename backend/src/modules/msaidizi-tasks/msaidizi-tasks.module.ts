import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AutonomyConfig } from './autonomy.config';
import { MsaidiziTasksController } from './msaidizi-tasks.controller';
import { MsaidiziTasksService } from './msaidizi-tasks.service';
import { MsaidiziReasoningModule } from '../msaidizi-reasoning/msaidizi-reasoning.module';
import { MsaidiziModule } from '../msaidizi/msaidizi.module';

/**
 * Durable task persistence boundary. The runtime module imports this module,
 * but AutonomyConfig keeps every route and dispatcher inert until the separate
 * deployment switches are explicitly enabled.
 */
@Module({
  imports: [ConfigModule, PrismaModule, MsaidiziModule, MsaidiziReasoningModule],
  controllers: [MsaidiziTasksController],
  providers: [AutonomyConfig, MsaidiziTasksService],
  exports: [AutonomyConfig, MsaidiziTasksService],
})
export class MsaidiziTasksModule {}
