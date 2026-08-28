import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceDocumentStatusService } from './compliance-document-status.service';

function companyUser(): AuthUser {
  return {
    id: 'user-1',
    email: 'writer@itemba.local',
    roles: ['COMPANY_COMPLIANCE_MANAGER'],
    roleScopes: ['COMPANY'],
    permissions: ['compliance_document_status.manage'],
    companyId: 'company-1',
    companyAccess: [],
  };
}

function groupReadUser(): AuthUser {
  return {
    id: 'user-read',
    email: 'reader@itemba.local',
    roles: ['GROUP_AUDITOR'],
    roleScopes: ['GROUP'],
    role: { scope: 'GROUP' },
    permissions: ['compliance_document_status.manage'],
    companyId: null,
    companyAccess: [{ companyId: 'company-1', accessLevel: AccessLevel.READ }],
  };
}

describe('ComplianceDocumentStatusService hard-delete audit attribution', () => {
  it('retains the scoped record company after the row is deleted', async () => {
    const existing = { id: 'status-1', companyId: 'company-1', status: 'VALID' };
    const prisma = {
      complianceDocumentStatus: {
        findFirst: jest.fn().mockResolvedValue(existing),
        delete: jest.fn().mockResolvedValue(existing),
      },
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new ComplianceDocumentStatusService(prisma, audit);

    await service.remove('status-1', companyUser());

    expect(prisma.complianceDocumentStatus.delete).toHaveBeenCalledWith({
      where: { id: 'status-1' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        entityType: 'ComplianceDocumentStatus',
        entityId: 'status-1',
        userId: 'user-1',
        companyId: 'company-1',
        oldValue: existing,
      }),
    );
  });

  it('rejects delete when the scoped company grant is READ-only', async () => {
    const existing = { id: 'status-1', companyId: 'company-1', status: 'VALID' };
    const prisma = {
      complianceDocumentStatus: {
        findFirst: jest.fn().mockResolvedValue(existing),
        delete: jest.fn(),
      },
    } as any;
    const audit = { log: jest.fn() } as any;
    const service = new ComplianceDocumentStatusService(prisma, audit);

    await expect(service.remove('status-1', groupReadUser())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.complianceDocumentStatus.delete).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
