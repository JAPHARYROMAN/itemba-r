import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { MsaidiziDevicesModule } from '../msaidizi-devices/msaidizi-devices.module';
import {
  MsaidiziRecoveryController,
  MsaidiziRecoverySupervisorChannelController,
} from './msaidizi-recovery.controller';
import { MsaidiziRecoveryManifestSigner } from './msaidizi-recovery-manifest-signer.service';
import { MsaidiziRecoveryService } from './msaidizi-recovery.service';

@Module({
  imports: [ConfigModule, PrismaModule, MsaidiziDevicesModule],
  controllers: [MsaidiziRecoveryController, MsaidiziRecoverySupervisorChannelController],
  providers: [MsaidiziRecoveryManifestSigner, MsaidiziRecoveryService],
  exports: [MsaidiziRecoveryService],
})
export class MsaidiziRecoveryModule {}
