import { ForbiddenException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditEvidencePacksService } from './audit-evidence-packs.service';

function groupUser(accessLevel: AccessLevel): AuthUser {
  return {
    id: `user-${accessLevel.toLowerCase()}`,
    email: `${accessLevel.toLowerCase()}@itemba.local`,
    roles: ['GROUP_AUDITOR'],
    roleScopes: ['GROUP'],
    role: { scope: 'GROUP' },
    permissions: ['audit_evidence_packs.manage'],
    companyId: null,
    companyAccess: [{ companyId: 'company-1', accessLevel }],
  };
}

describe('AuditEvidencePacksService hard-delete audit attribution', () => {
  it('captures the authorized pack company before deleting an item', async () => {
    const pack = { id: 'pack-1', companyId: 'company-1', deletedAt: null };
    const item = { id: 'item-1', evidencePackId: 'pack-1', title: 'Evidence' };
    const prisma = {
      auditEvidencePack: { findFirst: jest.fn().mockResolvedValue(pack) },
      auditEvidencePackItem: {
        findFirst: jest.fn().mockResolvedValue(item),
        delete: jest.fn().mockResolvedValue(item),
      },
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new AuditEvidencePacksService(prisma, audit);

    await service.removeItem('pack-1', 'item-1', groupUser(AccessLevel.WRITE));

    expect(prisma.auditEvidencePackItem.delete).toHaveBeenCalledWith({
      where: { id: 'item-1' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        entityType: 'AuditEvidencePackItem',
        entityId: 'item-1',
        userId: 'user-write',
        companyId: 'company-1',
        oldValue: item,
      }),
    );
  });

  it('rejects item deletion for a GROUP user with only READ access to the pack company', async () => {
    const pack = { id: 'pack-1', companyId: 'company-1', deletedAt: null };
    const prisma = {
      auditEvidencePack: { findFirst: jest.fn().mockResolvedValue(pack) },
      auditEvidencePackItem: {
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    } as any;
    const audit = { log: jest.fn() } as any;
    const service = new AuditEvidencePacksService(prisma, audit);

    await expect(
      service.removeItem('pack-1', 'item-1', groupUser(AccessLevel.READ)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.auditEvidencePackItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.auditEvidencePackItem.delete).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
