import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CcmNoticesService } from './ccm-notices.service';
import { CcmNoticesController } from './ccm-notices.controller';
import { AGENT_EXCLUDED_KEY } from '../../../common/decorators/agent-excluded.decorator';
import { PERMISSIONS_KEY } from '../../../common/decorators/require-permissions.decorator';
const user: AuthUser = {
  id: 'operator',
  email: 'example@example.invalid',
  roles: [],
  roleScopes: ['COMPANY'],
  companyId: 'company',
  companyAccess: [{ companyId: 'extra', accessLevel: 'READ' }],
  permissions: ['employees.view', 'disciplinary_actions.view'],
};
const action = {
  actionNumber: 'DA-EXAMPLE',
  type: 'WRITTEN_WARNING',
  issuedAt: new Date('2026-09-01'),
  reason: 'Synthetic reason',
  status: 'ACTIVE',
};
const employee = {
  id: 'employee',
  companyId: 'company',
  employeeCode: 'EXAMPLE',
  fullName: 'Alex Example',
  company: { id: 'company', name: 'Example Company', code: 'EXAMPLE', profile: null },
  contracts: [],
  disciplinaryActions: [action],
  baseSalary: 0,
  salaryCurrency: 'TZS',
  hireDate: null,
};
const dispute = {
  id: 'dispute',
  companyId: 'company',
  employee,
  company: employee.company,
  disciplinaryActions: [action],
  disputeNumber: 'DIS-EXAMPLE',
  type: 'GRIEVANCE',
  status: 'RAISED',
  raisedAt: new Date('2026-09-01'),
  summary: 'Synthetic summary',
};
function setup() {
  const employeeQuery = jest.fn().mockResolvedValue(employee),
    disputeQuery = jest.fn().mockResolvedValue(dispute);
  return {
    employeeQuery,
    disputeQuery,
    service: new CcmNoticesService({
      employee: { findFirst: employeeQuery },
      employmentDispute: { findFirst: disputeQuery },
    } as never),
  };
}
describe('CCM scoped document reads', () => {
  it('passes the authenticated user through both controllers and retains read permissions and agent exclusion', async () => {
    const service = { terminationNotice: jest.fn(), cmaReferralForm: jest.fn() };
    const controller = new CcmNoticesController(service as never);
    controller.termination('employee', user);
    controller.cmaReferral('dispute', user);
    expect(service.terminationNotice).toHaveBeenCalledWith('employee', user);
    expect(service.cmaReferralForm).toHaveBeenCalledWith('dispute', user);
    for (const handler of [controller.termination, controller.cmaReferral]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['employees.view']);
      expect(Reflect.getMetadata(AGENT_EXCLUDED_KEY, handler)).toBe(true);
    }
  });
  it('scopes both direct reads to primary and additional readable companies', async () => {
    const { service, employeeQuery, disputeQuery } = setup();
    await service.terminationNotice('employee', user);
    await service.cmaReferralForm('dispute', user);
    for (const [query, id] of [
      [employeeQuery, 'employee'],
      [disputeQuery, 'dispute'],
    ] as const) {
      expect(query.mock.calls[0][0].where).toEqual({
        id,
        deletedAt: null,
        companyId: { in: ['company', 'extra'] },
      });
    }
  });
  it('fails closed without company membership or a valid visible record', async () => {
    const { service, employeeQuery, disputeQuery } = setup();
    employeeQuery.mockResolvedValue(null);
    disputeQuery.mockResolvedValue(null);
    const noCompanies = { ...user, companyId: null, companyAccess: [] };
    await expect(service.terminationNotice('employee', noCompanies)).rejects.toThrow(
      'Employee not found',
    );
    await expect(service.cmaReferralForm('dispute', noCompanies)).rejects.toThrow(
      'Dispute not found',
    );
    expect(employeeQuery.mock.calls[0][0].where).toEqual({ id: { in: [] }, deletedAt: null });
    expect(disputeQuery.mock.calls[0][0].where).toEqual({ id: { in: [] }, deletedAt: null });
  });
  it('suppresses disciplinary history in the query and payload without its read permission', async () => {
    const { service, employeeQuery, disputeQuery } = setup();
    const viewer = { ...user, permissions: ['employees.view'] };
    const results = [
      await service.terminationNotice('employee', viewer),
      await service.cmaReferralForm('dispute', viewer),
    ];
    for (const result of results)
      expect(result).toMatchObject({ disciplinaryHistoryIncluded: false, disciplinaryHistory: [] });
    for (const query of [employeeQuery, disputeQuery])
      expect(query.mock.calls[0][0].include.disciplinaryActions.where.id).toEqual({ in: [] });
  });
  it('retains termination payload, zero salary, operator blanks and existing history selection', async () => {
    const { service, employeeQuery } = setup();
    const result = await service.terminationNotice('employee', user);
    expect(result).toMatchObject({
      formCode: 'Form 1',
      employee: { fullName: 'Alex Example' },
      employment: { baseSalary: 0, tenureMonths: null },
      disciplinaryHistory: [action],
      disciplinaryHistoryIncluded: true,
    });
    expect(result.operatorFields).toHaveLength(7);
    expect(employeeQuery.mock.calls[0][0].include.disciplinaryActions).toEqual({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'EXPIRED'] } },
      orderBy: { issuedAt: 'desc' },
      take: 5,
    });
  });
  it('retains referral payload with nullable optional fields and the existing full linked history', async () => {
    const { service, disputeQuery } = setup();
    const result = await service.cmaReferralForm('dispute', user);
    expect(result).toMatchObject({
      formCode: 'Form CMA-F1',
      dispute: {
        disputeNumber: 'DIS-EXAMPLE',
        summary: 'Synthetic summary',
        cmaReferenceNumber: null,
      },
      employee: { baseSalary: 0 },
      raisedBy: null,
      mediatedBy: null,
      disciplinaryHistory: [action],
    });
    expect(disputeQuery.mock.calls[0][0].include.disciplinaryActions).toEqual({
      where: { deletedAt: null },
      orderBy: { issuedAt: 'desc' },
    });
  });
});
