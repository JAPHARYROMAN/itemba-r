import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { DirectMtlsDevice } from '../../common/decorators/direct-mtls-device.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RecentAuth } from '../../common/decorators/recent-auth.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import {
  ActionFencedReceiptDto,
  ActionProgressDto,
  ActionResultDto,
  CapabilityManifestSnapshotDto,
  CompanionHeartbeatDto,
  CompletePairingDto,
  CompleteSupervisorEnrollmentDto,
  CreatePairingCodeDto,
  CreateSupervisorEnrollmentCodeDto,
  PollDeviceCommandsDto,
  DeviceJournalReconciliationDto,
  DeviceJournalHeadDto,
} from './dto/msaidizi-device.dto';
import { MsaidiziDevicesService } from './msaidizi-devices.service';
import { DirectMtlsDeviceGuard } from './direct-mtls-device.guard';
import { MsaidiziDeviceJournalLedgerService } from './msaidizi-device-journal-ledger.service';

@ApiTags('msaidizi-devices')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use', 'msaidizi.oversight')
@Controller('msaidizi/devices')
export class MsaidiziDevicesController {
  constructor(private readonly devices: MsaidiziDevicesService) {}

  @Post('pair-codes')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Create one short-lived, single-use Windows pairing code' })
  createPairingCode(@Body() dto: CreatePairingCodeDto, @CurrentUser() user: AuthUser) {
    return this.devices.createPairingCode(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List global Msaidizi workstation enrollment state' })
  list() {
    return this.devices.list();
  }

  @Post(':id/supervisor-enrollment-codes')
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Create one role-bound, single-use supervisor enrollment code' })
  createSupervisorEnrollmentCode(
    @Param('id') id: string,
    @Body() dto: CreateSupervisorEnrollmentCodeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.devices.createSupervisorEnrollmentCode(id, dto, user);
  }

  @Post('kill-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Emergency-kill every enrolled Msaidizi workstation' })
  killAll(@CurrentUser() user: AuthUser) {
    return this.devices.killAll(user);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke one device certificate binding and every active lease' })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.devices.revoke(id, user);
  }

  @Post(':id/kill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emergency-kill one device and stop all later dispatches' })
  kill(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.devices.kill(id, user);
  }
}

/** Device-authenticated protocol. Direct TLS socket identity replaces bearer auth. */
@ApiTags('msaidizi-device-channel')
@Public()
@AgentExcluded()
@DirectMtlsDevice()
@UseGuards(DirectMtlsDeviceGuard)
@Controller('msaidizi/devices')
export class MsaidiziDeviceChannelController {
  constructor(
    private readonly devices: MsaidiziDevicesService,
    private readonly journalLedger: MsaidiziDeviceJournalLedgerService,
  ) {}

  @Post('pairing/complete')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  completePairing(@Body() dto: CompletePairingDto, @Req() request: Request) {
    return this.devices.completePairing(dto, request);
  }

  @Post('supervisor-enrollment/complete')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  completeSupervisorEnrollment(
    @Body() dto: CompleteSupervisorEnrollmentDto,
    @Req() request: Request,
  ) {
    return this.devices.completeSupervisorEnrollment(dto, request);
  }

  @Post('channel/poll')
  @HttpCode(HttpStatus.OK)
  poll(@Body() dto: PollDeviceCommandsDto, @Req() request: Request) {
    return this.devices.poll(dto, request);
  }

  @Post('channel/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Body() dto: CompanionHeartbeatDto, @Req() request: Request) {
    return this.devices.heartbeat(dto, request);
  }

  @Post('channel/journal-reconcile')
  @HttpCode(HttpStatus.OK)
  reconcileJournal(@Body() dto: DeviceJournalReconciliationDto, @Req() request: Request) {
    return this.journalLedger.reconcile(dto, request);
  }

  @Post('channel/journal-head')
  @HttpCode(HttpStatus.OK)
  journalHead(@Body() dto: DeviceJournalHeadDto, @Req() request: Request) {
    return this.journalLedger.head(dto, request);
  }

  @Post('channel/manifest')
  @HttpCode(HttpStatus.OK)
  manifest(@Body() dto: CapabilityManifestSnapshotDto, @Req() request: Request) {
    return this.devices.updateManifest(dto, request);
  }

  @Post('channel/progress')
  @HttpCode(HttpStatus.OK)
  progress(@Body() dto: ActionProgressDto, @Req() request: Request) {
    return this.devices.progress(dto, request);
  }

  @Post('channel/result')
  @HttpCode(HttpStatus.OK)
  result(@Body() dto: ActionResultDto, @Req() request: Request) {
    return this.devices.result(dto, request);
  }

  @Post('channel/action-fenced')
  @HttpCode(HttpStatus.OK)
  actionFenced(@Body() dto: ActionFencedReceiptDto, @Req() request: Request) {
    return this.devices.actionFenced(dto, request);
  }
}
