import { Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import { GeneratedDocumentsQueryDto } from '../../common/dto/resource-query.dto';
import { Request, Response } from 'express';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { GeneratedDocumentsService } from './generated-documents.service';
import { GenerateBusinessPdfDto } from './dto/generate-business-pdf.dto';
import { GenerateTablePdfDto } from './dto/generate-table-pdf.dto';
import {
  ExportBusinessDocumentDto,
  ExportTableDocumentDto,
  ExportLetterDto,
} from './dto/export-document.dto';

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

  @Get('letterhead')
  letterhead(@Query('companyId') companyId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.letterhead(companyId, user);
  }

  @Get('letterhead-companies')
  letterheadCompanies(@CurrentUser() user: AuthUser) {
    return this.service.letterheadCompanies(user);
  }

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Post('export')
  @AgentExcluded()
  @RequireAnyPermissions(...BUSINESS_PDF_SOURCE_PERMISSIONS)
  async exportBusiness(
    @Body() dto: ExportBusinessDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.sendExport(res, await this.service.exportBusinessDocument(dto, user, req.ip));
  }

  // Authenticated, client-supplied report data; company letterhead is scoped separately.
  @Post('table-export')
  async exportTable(
    @Body() dto: ExportTableDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.sendExport(res, await this.service.exportTableDocument(dto, user, req.ip));
  }

  // Added by the ITEMBA OS redesign (4a155f19); not yet reviewed for agent
  // eligibility, so it stays out of the agent tool registry (fail closed).
  @Post('letter')
  @AgentExcluded()
  @RequirePermissions('documents.manage')
  async exportLetter(
    @Body() dto: ExportLetterDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.sendExport(res, await this.service.exportLetter(dto, user, req.ip));
  }

  private sendExport(
    res: Response,
    result: { buffer: Buffer; fileName: string; mimeType: string },
  ) {
    res.set({
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${safeDispositionFileName(result.fileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.send(result.buffer);
  }

  @Get()
  @RequirePermissions('generated_documents.list')
  findAll(@Query() query: GeneratedDocumentsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Post('pdf')
  @AgentExcluded('filesystem_materialization_not_represented')
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
  @AgentExcluded('read_writes_audit_ledger')
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
      'Cache-Control': 'private, no-store',
    });
    return sf;
  }

  @Get(':id/preview')
  @AgentExcluded('read_writes_audit_ledger')
  @RequireAnyPermissions(...BUSINESS_PDF_SOURCE_PERMISSIONS, 'generated_documents.view')
  @Header('Cache-Control', 'private, no-store')
  preview(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.preview(id, user, req.ip);
  }

  @Get(':id')
  @RequirePermissions('generated_documents.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
