import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EmailService } from '../../common/services/email.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DocumentsService } from '../documents/documents.service';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import { SupplierOrderDraftEmailDto } from './dto/supplier-order-draft.dto';
import { SupplierOrderDraftsService } from './supplier-order-drafts.service';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

@Injectable()
export class SupplierOrderDraftSharingService {
  constructor(
    private readonly drafts: SupplierOrderDraftsService,
    private readonly generatedDocuments: GeneratedDocumentsService,
    private readonly documents: DocumentsService,
    private readonly email: EmailService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async emailPdf(
    id: string,
    dto: SupplierOrderDraftEmailDto,
    user: AuthUser,
    ipAddress?: string,
  ) {
    const draft = await this.drafts.findOne(id, user);
    const generated = await this.generatedDocuments.generateBusinessPdf(
      { entityType: 'SUPPLIER_ORDER_DRAFT', entityId: id },
      user,
      ipAddress,
    );
    const pdf = await this.documents.readFileBuffer(generated.document.id, user);
    const subject = dto.subject?.trim() || `${draft.draftNumber} - Supplier Order Draft`;
    const message = dto.message?.trim() ||
      `Please find attached supplier order draft ${draft.draftNumber} for your review.`;
    const companyName = draft.company?.name || 'ITEMBA GROUP';
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');
    const html = [
      `<p>${safeMessage}</p>`,
      `<p><strong>Document:</strong> ${escapeHtml(draft.draftNumber)}<br>`,
      `<strong>Supplier:</strong> ${escapeHtml(draft.supplierName)}<br>`,
      `<strong>From:</strong> ${escapeHtml(companyName)}</p>`,
      '<p>The PDF document is attached to this email.</p>',
    ].join('');
    const text = `${message}\n\nDocument: ${draft.draftNumber}\nSupplier: ${draft.supplierName}\nFrom: ${companyName}\n\nThe PDF document is attached.`;

    const sent = await this.email.sendEmailWithAttachments(
      dto.to,
      subject,
      html,
      text,
      [{ filename: pdf.fileName, content: pdf.buffer, contentType: pdf.mimeType }],
      dto.cc ?? [],
    );

    await this.auditLogs.log({
      action: 'SUPPLIER_ORDER_DRAFT_SHARE_EMAIL',
      entityType: 'SupplierOrderDraft',
      entityId: draft.id,
      userId: user.id,
      companyId: draft.companyId,
      ipAddress,
      metadata: {
        draftNumber: draft.draftNumber,
        recipient: dto.to,
        cc: dto.cc ?? [],
        sent,
        generatedDocumentId: generated.generatedDocument.id,
        documentId: generated.document.id,
        fileName: pdf.fileName,
      },
    });

    return {
      sent,
      recipient: dto.to,
      fileName: pdf.fileName,
      generatedDocumentId: generated.generatedDocument.id,
      message: sent
        ? 'Supplier order draft emailed with the PDF attached'
        : 'SMTP is unavailable or delivery failed. Use the mail-app fallback instead.',
    };
  }
}
