import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { DirectMtlsDevice } from '../../common/decorators/direct-mtls-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RecentAuth } from '../../common/decorators/recent-auth.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { MsaidiziRecoverySupervisorMtlsGuard } from '../msaidizi-devices/msaidizi-supervisor-mtls.guard';
import {
  MsaidiziRecoveryProgressDto,
  MsaidiziRecoveryResultDto,
  PollMsaidiziRecoveryDto,
  QueryMsaidiziRecoveryDto,
  RequestMsaidiziRecoveryDto,
} from './dto/msaidizi-recovery.dto';
import { MsaidiziRecoveryService } from './msaidizi-recovery.service';

@ApiTags('msaidizi-trusted-recovery')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use', 'msaidizi.oversight')
@Controller('msaidizi/recovery-commands')
export class MsaidiziRecoveryController {
  constructor(private readonly recovery: MsaidiziRecoveryService) {}

  @Post()
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @ApiOperation({ summary: 'Authorize one exact signed quarantine recovery outside model control' })
  request(@Body() dto: RequestMsaidiziRecoveryDto, @CurrentUser() user: AuthUser) {
    return this.recovery.request(dto, user);
  }

  @Get()
  list(@Query() query: QueryMsaidiziRecoveryDto, @CurrentUser() user: AuthUser) {
    return this.recovery.list(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.recovery.findOne(id, user);
  }
}

@ApiTags('msaidizi-recovery-supervisor-channel')
@Public()
@AgentExcluded()
@DirectMtlsDevice()
@UseGuards(MsaidiziRecoverySupervisorMtlsGuard)
@Controller('msaidizi/recovery-supervisor/channel')
export class MsaidiziRecoverySupervisorChannelController {
  constructor(private readonly recovery: MsaidiziRecoveryService) {}

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  poll(@Body() dto: PollMsaidiziRecoveryDto, @Req() request: Request) {
    return this.recovery.poll(dto, request);
  }

  @Post('progress')
  @HttpCode(HttpStatus.OK)
  progress(@Body() dto: MsaidiziRecoveryProgressDto, @Req() request: Request) {
    return this.recovery.progress(dto, request);
  }

  @Post('result')
  @HttpCode(HttpStatus.OK)
  result(@Body() dto: MsaidiziRecoveryResultDto, @Req() request: Request) {
    return this.recovery.result(dto, request);
  }
}
