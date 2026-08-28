import {
  BadRequestException,
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  NestInterceptor,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import os from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { DirectMtlsDevice } from '../../common/decorators/direct-mtls-device.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziArtifactsService } from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { MsaidiziUpdateSupervisorMtlsGuard } from '../msaidizi-devices/msaidizi-supervisor-mtls.guard';
import {
  AckMsaidiziUpdateDeploymentDto,
  CreateMsaidiziUpdateCandidateDto,
  MsaidiziUpdateProgressDto,
  MsaidiziUpdateResultDto,
  PollMsaidiziUpdateDeploymentsDto,
  QueryMsaidiziUpdateCandidateDto,
  ReportMsaidiziUpdateHealthDto,
  ReportMsaidiziUpdateEvaluationUsageDto,
  RolloutMsaidiziUpdateDto,
  SignedEvaluatorAttestationDto,
  StartMsaidiziUpdateEvaluationRunDto,
  SubmitMsaidiziUpdateEvaluationDto,
} from './dto/msaidizi-update.dto';
import { MsaidiziUpdateEvaluationService } from './msaidizi-update-evaluation.service';
import { MsaidiziUpdateEvaluationOrchestrator } from './msaidizi-update-evaluation-orchestrator.service';
import { MsaidiziEvaluatorMtlsGuard } from './msaidizi-evaluator-mtls.guard';
import { MsaidiziUpdatesService } from './msaidizi-updates.service';

@ApiTags('msaidizi-update-candidates')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use', 'msaidizi.oversight')
@Controller('msaidizi/update-candidates')
export class MsaidiziUpdatesController {
  constructor(private readonly updates: MsaidiziUpdatesService) {}

  @Post()
  @ApiOperation({ summary: 'Register an artifact-backed, recoverable update candidate' })
  create(@Body() dto: CreateMsaidiziUpdateCandidateDto, @CurrentUser() user: AuthUser) {
    return this.updates.create(dto, user);
  }

  @Get()
  list(@Query() query: QueryMsaidiziUpdateCandidateDto, @CurrentUser() user: AuthUser) {
    return this.updates.list(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.updates.findOne(id, user);
  }

  @Post(':id/evaluate')
  evaluate(
    @Param('id') id: string,
    @Body() dto: SubmitMsaidiziUpdateEvaluationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.updates.submitEvaluation(id, dto, user);
  }

  @Post(':id/rollout')
  rollout(
    @Param('id') id: string,
    @Body() dto: RolloutMsaidiziUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.updates.rollout(id, dto, user);
  }

  @Post(':id/health')
  health(
    @Param('id') id: string,
    @Body() dto: ReportMsaidiziUpdateHealthDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.updates.reportHealth(id, dto, user);
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.updates.rollback(id, user);
  }
}

@Injectable()
class MsaidiziEvaluatorTempFileCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { file?: Express.Multer.File }>();
    return next.handle().pipe(finalize(() => removeEvaluatorTempFile(request.file?.path)));
  }
}

function removeEvaluatorTempFile(filePath: string | undefined): void {
  if (!filePath) return;
  const resolvedPath = resolve(filePath);
  const temporaryRoot = resolve(os.tmpdir());
  if (
    dirname(resolvedPath) !== temporaryRoot ||
    !basename(resolvedPath).startsWith('msaidizi-evaluator-')
  ) {
    return;
  }
  try {
    rmSync(resolvedPath, { force: true });
  } catch {
    // Service-level cleanup reports the primary error; cleanup is best effort.
  }
}

/**
 * Signature-authenticated verifier channel. There is intentionally no caller
 * supplied signer selector: the canonical claims carry the key id and the
 * signature must verify against that exact role-bound allowlist entry.
 */
@ApiTags('msaidizi-update-verifier-channel')
@Public()
@AgentExcluded()
@DirectMtlsDevice()
@UseGuards(MsaidiziEvaluatorMtlsGuard)
@Controller('msaidizi/update-verifier')
export class MsaidiziUpdateVerifierController {
  constructor(
    private readonly evaluation: MsaidiziUpdateEvaluationService,
    private readonly orchestrator: MsaidiziUpdateEvaluationOrchestrator,
  ) {}

  @Post('runs/poll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lease one immutable generated update to the isolated evaluator' })
  pollEvaluationRun() {
    return this.orchestrator.poll();
  }

  @Post('runs/:runId/start')
  @HttpCode(HttpStatus.OK)
  startEvaluationRun(
    @Param('runId') runId: string,
    @Body() dto: StartMsaidiziUpdateEvaluationRunDto,
  ) {
    return this.orchestrator.start(runId, dto.leaseId);
  }

  @Post('runs/:runId/heartbeat')
  @HttpCode(HttpStatus.OK)
  reportEvaluationUsage(
    @Param('runId') runId: string,
    @Body() dto: ReportMsaidiziUpdateEvaluationUsageDto,
  ) {
    return this.orchestrator.heartbeat(runId, dto.leaseId, dto);
  }

  @Get('runs/:runId/generation-artifact')
  async generationArtifact(
    @Param('runId') runId: string,
    @Headers('x-msaidizi-evaluation-lease') leaseId: string,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.orchestrator.generationArtifact(runId, leaseId);
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Length', artifact.byteSize.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Msaidizi-Artifact-Sha256', artifact.sha256);
    if (artifact.evaluationUsageFloor) {
      response.setHeader(
        'X-Msaidizi-Usage-Bytes-Read-Floor',
        artifact.evaluationUsageFloor.bytesRead.toString(),
      );
      response.setHeader(
        'X-Msaidizi-Usage-Egress-Bytes-Floor',
        artifact.evaluationUsageFloor.externalEgressBytes.toString(),
      );
    }
    artifact.stream.on('error', () => response.destroy());
    artifact.stream.pipe(response);
  }

  @Post('artifacts')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Ingest a new encrypted artifact from signed verifier evidence' })
  @UseInterceptors(
    new MsaidiziEvaluatorTempFileCleanupInterceptor(),
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_request, _file, callback) =>
          callback(null, `msaidizi-evaluator-${randomUUID()}`),
      }),
      limits: { fileSize: 250 * 1024 * 1024, files: 1 },
    }),
  )
  ingestArtifact(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SignedEvaluatorAttestationDto,
  ) {
    return this.evaluation.ingestTrustedArtifact(file, dto);
  }

  @Post('candidates/:id/evaluation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decide a candidate from one runner and two signed reviews' })
  evaluate(@Param('id') id: string, @Body() dto: SubmitMsaidiziUpdateEvaluationDto) {
    return this.evaluation.submit(id, dto);
  }
}

/** Protocol exposed only on the direct client-certificate TLS listener. */
@ApiTags('msaidizi-update-supervisor-channel')
@Public()
@AgentExcluded()
@DirectMtlsDevice()
@UseGuards(MsaidiziUpdateSupervisorMtlsGuard)
@Controller('msaidizi/update-supervisor/channel')
export class MsaidiziUpdateSupervisorChannelController {
  constructor(
    private readonly updates: MsaidiziUpdatesService,
    private readonly artifacts: MsaidiziArtifactsService,
  ) {}

  @Post('poll')
  @HttpCode(HttpStatus.OK)
  poll(@Body() dto: PollMsaidiziUpdateDeploymentsDto, @Req() request: Request) {
    return this.updates.pollSupervisor(dto, request);
  }

  @Post('ack')
  @HttpCode(HttpStatus.OK)
  acknowledge(@Body() dto: AckMsaidiziUpdateDeploymentDto, @Req() request: Request) {
    return this.updates.acknowledgeSupervisorDelivery(dto, request);
  }

  @Post('progress')
  @HttpCode(HttpStatus.OK)
  progress(@Body() dto: MsaidiziUpdateProgressDto, @Req() request: Request) {
    return this.updates.supervisorProgress(dto, request);
  }

  @Post('result')
  @HttpCode(HttpStatus.OK)
  result(@Body() dto: MsaidiziUpdateResultDto, @Req() request: Request) {
    return this.updates.supervisorResult(dto, request);
  }

  @Get('deployments/:deploymentId/artifact')
  async artifact(
    @Param('deploymentId') deploymentId: string,
    @Query('role') role: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (role !== 'source' && role !== 'rollback') {
      throw new BadRequestException('Artifact role must be source or rollback');
    }
    const authorized = await this.updates.authorizeSupervisorArtifact(deploymentId, role, request);
    const artifact = await this.artifacts.downloadForUpdateSupervisor(
      authorized.id,
      authorized.sha256,
    );
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', artifact.byteSize.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Msaidizi-Artifact-Sha256', artifact.sha256);
    artifact.stream.on('error', () => response.destroy());
    artifact.stream.pipe(response);
  }
}
