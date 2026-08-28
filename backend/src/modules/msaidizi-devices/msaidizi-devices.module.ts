import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MsaidiziArtifactsModule } from '../msaidizi-artifacts/msaidizi-artifacts.module';
import { ActionTokenService } from './action-token.service';
import { DirectMtlsDeviceGuard } from './direct-mtls-device.guard';
import { FenceActionTokenService } from './fence-action-token.service';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';
import {
  MsaidiziDeviceChannelController,
  MsaidiziDevicesController,
} from './msaidizi-devices.controller';
import { MsaidiziDevicesService } from './msaidizi-devices.service';
import { MsaidiziDeviceJournalLedgerService } from './msaidizi-device-journal-ledger.service';
import {
  MsaidiziRecoverySupervisorMtlsGuard,
  MsaidiziUpdateSupervisorMtlsGuard,
} from './msaidizi-supervisor-mtls.guard';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditLogsModule,
    NotificationsModule,
    MsaidiziArtifactsModule,
  ],
  controllers: [MsaidiziDevicesController, MsaidiziDeviceChannelController],
  providers: [
    MsaidiziDeviceConfig,
    ActionTokenService,
    FenceActionTokenService,
    DirectMtlsDeviceGuard,
    MsaidiziUpdateSupervisorMtlsGuard,
    MsaidiziRecoverySupervisorMtlsGuard,
    MsaidiziDeviceJournalLedgerService,
    MsaidiziDevicesService,
  ],
  exports: [
    DirectMtlsDeviceGuard,
    MsaidiziUpdateSupervisorMtlsGuard,
    MsaidiziRecoverySupervisorMtlsGuard,
    MsaidiziDeviceConfig,
    MsaidiziDeviceJournalLedgerService,
    MsaidiziDevicesService,
  ],
})
export class MsaidiziDevicesModule {}
