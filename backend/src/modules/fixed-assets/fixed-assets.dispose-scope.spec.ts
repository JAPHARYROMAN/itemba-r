import { FixedAssetStatus, RoleScope } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountResolverService, CompanyScopeService } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FixedAssetsService } from './fixed-assets.service';

const COMPANY_PRINCIPAL: AuthUser = {
  id: 'company-asset-operator',
  email: 'company-asset-operator@itemba.invalid',
  roles: ['COMPANY_ASSET_OPERATOR'],
  roleScopes: [RoleScope.COMPANY],
  role: { scope: RoleScope.COMPANY },
  permissions: ['fixed-assets.update'],
  companyId: 'company-a',
  companyAccess: [{ companyId: 'company-a', accessLevel: 'MANAGE' }],
};

describe('FixedAssetsService.dispose group-control boundary', () => {
  it('denies a company principal carrying fixed-assets.update before any read or mutation', async () => {
    const prismaMock = {
      fixedAsset: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const prisma = prismaMock as unknown as PrismaService;
    const auditMock = { log: jest.fn() };
    const audit = auditMock as unknown as AuditLogsService;
    const companyScope = new CompanyScopeService(prisma);
    const service = new FixedAssetsService(
      prisma,
      audit,
      companyScope,
      {} as AccountResolverService,
      {} as PostingEngineService,
    );

    await expect(
      service.dispose(
        'fixed-asset-a',
        {
          disposalDate: '2031-07-01T00:00:00.000Z',
          disposalStatus: FixedAssetStatus.DISPOSED,
          disposalValue: '25.50',
        },
        COMPANY_PRINCIPAL,
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Group-scoped role required to dispose fixed assets',
    });

    expect(prismaMock.fixedAsset.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.fixedAsset.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditMock.log).not.toHaveBeenCalled();
  });
});
