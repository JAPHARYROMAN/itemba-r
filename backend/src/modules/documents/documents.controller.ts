import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { DocumentOwnerType } from '@prisma/client';
import { diskStorage } from 'multer';
import * as os from 'os';
import { Response, Request } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  /** Upload a file and register document metadata */
  @Post('upload')
  @RequirePermissions('documents.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.upload(file, dto, user, req.ip);
  }

  @Get()
  @RequirePermissions('documents.view')
  findAll(@Query() query: QueryDocumentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('summary')
  @RequirePermissions('documents.view')
  getSummary(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.service.getSummary(user, companyId);
  }

  @Get('expiring')
  @RequirePermissions('documents.view')
  getExpiring(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.getExpiring(user, days ? parseInt(days, 10) : 30, companyId);
  }

  @Get('by-entity')
  @RequirePermissions('documents.view')
  findByEntity(
    @Query('ownerType') ownerType: DocumentOwnerType,
    @Query('ownerId') ownerId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.findByEntity(ownerType, ownerId, user, req.ip);
  }

  @Get(':id')
  @RequirePermissions('documents.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.findOne(id, user, req.ip);
  }

  @Get(':id/download')
  @RequirePermissions('documents.view')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('inline') inline?: string,
  ) {
    const sf = await this.service.download(id, user, req.ip);
    const disposition = inline === '1' || inline === 'true' ? 'inline' : 'attachment';
    res.set({
      'Content-Type': sf.doc.mimeType,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(sf.doc.fileName)}"`,
    });
    return sf;
  }

  @Get(':id/audit-history')
  @RequirePermissions('documents.view')
  getAuditHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAuditHistory(id, user);
  }

  @Patch(':id')
  @RequirePermissions('documents.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, user, req.ip);
  }

  @Delete(':id')
  @RequirePermissions('documents.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remove(id, user, req.ip);
  }
}
