import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { GeneratedDocumentsService } from './generated-documents.service';
import { GenerateBusinessPdfDto } from './dto/generate-business-pdf.dto';
import { GenerateTablePdfDto } from './dto/generate-table-pdf.dto';

const BUSINESS_PDF_SOURCE_PERMISSIONS = [
  'documents.manage',
  'sales.view',
  'purchases.view',
  'supplier_order_drafts.export',
  'quotations.view',
  'proformas.view',
  'delivery_notes.view',
  'customers.view',
  'grn.view',
  'supplier_invoices.view',
  'payroll.view',
  'receivables.view',
  'customer-payments.view',
  'expenses.view',
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

  /**
   * Deliberately NO permission decorator: authenticated-only (JwtAuthGuard is
   * global and permissions.guard.ts allows undecorated endpoints). The rows
   * come from the client and were already authorized at fetch time;
   * letterhead/logo reads have their own scope checks; abuse is bounded by
   * the DTO caps + the global ThrottlerGuard + the audit row.
   *
   * Non-passthrough @Res() so the binary bypasses the TransformInterceptor,
   * same as customer-statements export/pdf.
   */
  @Post('table-pdf')
  async generateTablePdf(
    @Body() dto: GenerateTablePdfDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.service.generateTablePdf(dto, user, req.ip);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDispositionFileName(result.fileName)}"`,
    );
    res.setHeader('X-Generated-Document-Id', result.generatedDocumentId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.buffer);
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
