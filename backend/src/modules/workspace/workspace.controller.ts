import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceService } from './workspace.service';
import { WorkspaceDraftsService } from './workspace-drafts.service';

/** Human-owned shell state. Not an agent business capability. */
@Controller('workspace')
@UseGuards(JwtAuthGuard)
@AgentExcluded()
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly drafts: WorkspaceDraftsService,
  ) {}
  @Get('sessions') @Header('Cache-Control', 'private, no-store') sessions(
    @CurrentUser() u: AuthUser,
  ) {
    return this.workspace.sessions(u);
  }
  @Put('sessions/:id') saveSession(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workspace.saveSession(u, id, body);
  }
  @Delete('sessions/:id') deleteSession(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.workspace.deleteSession(u, id);
  }
  @Get('drafts') @Header('Cache-Control', 'private, no-store') listDrafts(
    @CurrentUser() u: AuthUser,
  ) {
    return this.drafts.list(u);
  }
  @Get('drafts/:id') @Header('Cache-Control', 'private, no-store') getDraft(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.drafts.get(u, id);
  }
  @Put('drafts/:id') saveDraft(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.save(u, id, body);
  }
  @Put('drafts/:id/lease') leaseDraft(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.lease(u, id, body);
  }
  @Post('drafts/:id/discard') discardDraft(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.discard(u, id, body);
  }
  @Get('wallpapers') @Header('Cache-Control', 'private, no-store') wallpapers(
    @CurrentUser() u: AuthUser,
  ) {
    return this.workspace.wallpapers(u);
  }
  @Post('wallpapers')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.workspace.uploadWallpaper(u, file);
  }
  @Get('wallpapers/:id/image') async image(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const image = await this.workspace.wallpaper(u, id);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(image);
  }
  @Delete('wallpapers/:id') deleteWallpaper(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.workspace.deleteWallpaper(u, id);
  }
}
