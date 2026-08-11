import { SupplierOrderDraftSharingService } from './supplier-order-draft-sharing.service';

describe('SupplierOrderDraftSharingService', () => {
  const user: any = { id: 'user-1' };

  function setup(sent = true) {
    const draft = {
      id: 'draft-1',
      draftNumber: 'SOD-2026-000001',
      companyId: 'company-1',
      supplierName: 'Supplier Ltd',
      company: { name: 'Westsides Company Ltd' },
    };
    const drafts = { findOne: jest.fn().mockResolvedValue(draft) };
    const generatedDocuments = {
      generateBusinessPdf: jest.fn().mockResolvedValue({
        generatedDocument: { id: 'generated-1' },
        document: { id: 'document-1' },
      }),
    };
    const documents = {
      readFileBuffer: jest.fn().mockResolvedValue({
        buffer: Buffer.from('pdf'),
        fileName: 'SOD-2026-000001.pdf',
        mimeType: 'application/pdf',
      }),
    };
    const email = { sendEmailWithAttachments: jest.fn().mockResolvedValue(sent) };
    const auditLogs = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new SupplierOrderDraftSharingService(
      drafts as any,
      generatedDocuments as any,
      documents as any,
      email as any,
      auditLogs as any,
    );
    return { service, drafts, generatedDocuments, documents, email, auditLogs };
  }

  it('generates and emails the branded PDF as a real attachment', async () => {
    const { service, email, auditLogs } = setup();
    const result = await service.emailPdf(
      'draft-1',
      {
        to: 'supplier@example.com',
        cc: ['accounts@example.com'],
        message: 'Please review this order draft.',
      },
      user,
      '127.0.0.1',
    );

    expect(email.sendEmailWithAttachments).toHaveBeenCalledWith(
      'supplier@example.com',
      'SOD-2026-000001 - Supplier Order Draft',
      expect.stringContaining('Please review this order draft.'),
      expect.stringContaining('Document: SOD-2026-000001'),
      [
        expect.objectContaining({
          filename: 'SOD-2026-000001.pdf',
          content: Buffer.from('pdf'),
          contentType: 'application/pdf',
        }),
      ],
      ['accounts@example.com'],
    );
    expect(auditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SUPPLIER_ORDER_DRAFT_SHARE_EMAIL',
        entityId: 'draft-1',
        metadata: expect.objectContaining({ sent: true, recipient: 'supplier@example.com' }),
      }),
    );
    expect(result.sent).toBe(true);
  });

  it('reports an actionable fallback when SMTP delivery is unavailable', async () => {
    const { service } = setup(false);
    const result = await service.emailPdf('draft-1', { to: 'supplier@example.com' }, user);

    expect(result.sent).toBe(false);
    expect(result.message).toContain('mail-app fallback');
  });
});
