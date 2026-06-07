import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GeneratedDocumentsService } from './generated-documents.service';
import { GenerateBusinessPdfDto } from './dto/generate-business-pdf.dto';

const BUSINESS_PDF_SOURCE_PERMISSIONS = [
  'documents.manage',
  'sales.view',
  'purchases.view',
  'quotations.view',
  'proformas.view',
  'delivery_notes.view',
  'customers.view',
];

const INLINE_SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
]);

function safeDispositionFileName(fileName: string): string {
  return fileName.replace(/[\\\"\r\n]/g, '_');
}

@Controller('generated-documents')
export class GeneratedDocumentsController {
  constructor(private readonly service: GeneratedDocumentsService) {}

  @Get()
  @RequirePermissions('generated_documents.list')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Post('pdf')
  @RequireAnyPermissions(...BUSINESS_PDF_SOURCE_PERMISSIONS)
  generatePdf(
    @Body() dto: GenerateBusinessPdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.generateBusinessPdf(dto, user, req.ip);
  }

  @Get(':id/download')
  @RequireAnyPermissions(...BUSINESS_PDF_SOURCE_PERMISSIONS, 'generated_documents.view')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('inline') inline?: string,
  ) {
    const sf = await this.service.download(id, user, req.ip);
    const inlineRequested = inline === '1' || inline === 'true';
    const disposition =
      inlineRequested && INLINE_SAFE_MIME_TYPES.has(sf.doc.mimeType) ? 'inline' : 'attachment';
    const fileName = safeDispositionFileName(sf.doc.fileName);
    res.set({
      'Content-Type': sf.doc.mimeType,
      'Content-Disposition': `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(sf.doc.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return sf;
  }

  @Get(':id')
  @RequirePermissions('generated_documents.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
