import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateMsaidiziArtifactDto, QueryMsaidiziArtifactDto } from './dto/msaidizi-artifact.dto';
import { MsaidiziArtifactsService } from './msaidizi-artifacts.service';
import { Query } from '@nestjs/common';

function dispositionName(value: string): string {
  return value.replace(/[\\"\r\n]/g, '_');
}

@ApiTags('msaidizi-artifacts')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller('msaidizi/artifacts')
export class MsaidiziArtifactsController {
  constructor(private readonly artifacts: MsaidiziArtifactsService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Encrypt and attach an untrusted artifact to a durable task' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, callback) => callback(null, `msaidizi-${randomUUID()}`),
      }),
      limits: { fileSize: 250 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateMsaidiziArtifactDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.artifacts.upload(file, dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List task-scoped artifact metadata and provenance' })
  list(@Query() query: QueryMsaidiziArtifactDto, @CurrentUser() user: AuthUser) {
    return this.artifacts.list(query, user);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Decrypt and stream a task artifact to its initiating user' })
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ): Promise<void> {
    const artifact = await this.artifacts.download(id, user);
    response.setHeader('Content-Type', artifact.mimeType);
    response.setHeader('Content-Length', artifact.byteSize.toString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Msaidizi-Artifact-Sha256', artifact.sha256);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${dispositionName(artifact.name)}"`,
    );
    artifact.stream.on('error', () => {
      if (!response.headersSent) response.status(500);
      response.destroy();
    });
    artifact.stream.pipe(response);
  }
}
