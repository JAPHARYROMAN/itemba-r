import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { DirectMtlsDevice } from '../../common/decorators/direct-mtls-device.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  FetchMsaidiziAuditSegmentDto,
  SubmitMsaidiziAuditCheckpointDto,
} from './dto/msaidizi-audit-signer.dto';
import {
  authenticatedAuditSignerPeer,
  MsaidiziAuditSignerGuard,
} from './msaidizi-audit-signer.guard';
import { MsaidiziAuditSignerService } from './msaidizi-audit-signer.service';

@ApiTags('msaidizi-trusted-audit-signer-channel')
@Public()
@AgentExcluded()
@DirectMtlsDevice()
@UseGuards(MsaidiziAuditSignerGuard)
@Controller('msaidizi/audit-signer/channel')
export class MsaidiziAuditSignerController {
  constructor(private readonly signer: MsaidiziAuditSignerService) {}

  @Post('segment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fetch one bounded exact task-event chain segment for signing' })
  segment(@Body() dto: FetchMsaidiziAuditSegmentDto, @Req() request: Request) {
    return this.signer.segment(dto, authenticatedAuditSignerPeer(request));
  }

  @Post('checkpoint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Append one independently signed task-event checkpoint' })
  checkpoint(@Body() dto: SubmitMsaidiziAuditCheckpointDto, @Req() request: Request) {
    return this.signer.checkpoint(dto, authenticatedAuditSignerPeer(request));
  }
}
