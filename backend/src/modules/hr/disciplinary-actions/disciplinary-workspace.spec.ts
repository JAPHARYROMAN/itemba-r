import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { DisciplinaryActionsQueryDto } from '../../../common/dto/resource-query.dto';
import { DisciplinaryActionsService } from './disciplinary-actions.service';
import { UpdateDisciplinaryActionDto } from './dto/update-disciplinary-action.dto';
const user: AuthUser = {
  id: 'reviewer',
  email: 'test@example.invalid',
  roles: [],
  permissions: [],
  roleScopes: ['COMPANY'],
  companyId: 'company',
  companyAccess: [{ companyId: 'read-only', accessLevel: 'READ' }],
};
const record = {
  id: 'action',
  actionNumber: 'DA-EXAMPLE',
  companyId: 'company',
  employeeId: 'employee',
  issuedById: 'issuer',
  type: 'WRITTEN_WARNING',
  status: 'PENDING_HR_APPROVAL',
  issuedAt: new Date('2026-09-01T06:30:00Z'),
  effectiveFrom: new Date('2026-09-01T06:30:00Z'),
  effectiveTo: new Date('2026-10-01T06:30:00Z'),
  fineAmount: null,
  fineDeductionId: null,
};
function setup() {
  const delegate = {
    findMany: jest.fn().mockResolvedValue([record]),
    count: jest.fn().mockResolvedValue(1),
    findFirst: jest.fn().mockResolvedValue(record),
    create: jest.fn().mockResolvedValue(record),
    update: jest.fn().mockResolvedValue({ ...record, status: 'ACTIVE' }),
  };
  const employee = { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
    dispute = { findFirst: jest.fn().mockResolvedValue({ id: 'dispute' }) },
    audit = { log: jest.fn().mockResolvedValue(undefined) },
    codes = { next: jest.fn().mockResolvedValue('DA-EXAMPLE') };
  const deduction = {
      findUnique: jest.fn().mockResolvedValue({ id: 'deduction' }),
      create: jest.fn(),
    },
    deductionType = { findFirst: jest.fn() };
  const service = new DisciplinaryActionsService(
    {
      disciplinaryAction: delegate,
      employee,
      employmentDispute: dispute,
      employeeDeduction: deduction,
      deductionType,
    } as never,
    audit as never,
    codes as never,
  );
  return { service, delegate, employee, dispute, audit, codes, deduction, deductionType };
}
describe('Disciplinary workspace', () => {
  it('combines search with company, employee, type, status and pagination using the same count constraint', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(DisciplinaryActionsQueryDto, {
      page: '2',
      limit: '20',
      search: ' Alex ',
      companyId: 'company',
      employeeId: 'employee',
      status: 'PENDING_GM_APPROVAL',
      type: 'WRITTEN_WARNING',
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll({ ...dto, page: 2, limit: 20, user });
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        companyId: 'company',
        employeeId: 'employee',
        status: 'PENDING_GM_APPROVAL',
        type: 'WRITTEN_WARNING',
        OR: [
          { actionNumber: { contains: 'Alex', mode: 'insensitive' } },
          { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
          { employee: { employeeCode: { contains: 'Alex', mode: 'insensitive' } } },
        ],
      },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll({ user, companyId: 'foreign' })).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('scopes direct reads and requires Write access for every mutation', async () => {
    const { service, delegate } = setup();
    await service.findOne('action', user);
    expect(delegate.findFirst.mock.calls[0][0].where).toEqual({
      id: 'action',
      deletedAt: null,
      companyId: { in: ['company', 'read-only'] },
    });
    delegate.findFirst.mockResolvedValue({ ...record, companyId: 'read-only' });
    await expect(service.update('action', { notes: 'test' }, user)).rejects.toThrow();
    await expect(service.remove('action', user)).rejects.toThrow();
    await expect(service.approve('action', user)).rejects.toThrow();
    expect(delegate.update).not.toHaveBeenCalled();
  });
  it('keeps non-verbal creation pending and validates employee/dispute membership before allocating a code', async () => {
    const { service, delegate, employee, dispute, codes } = setup();
    const dto = {
      companyId: 'company',
      employeeId: 'employee',
      disputeId: 'dispute',
      type: 'WRITTEN_WARNING' as const,
      issuedAt: '2026-09-01',
      reason: 'Synthetic test reason',
    };
    employee.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(dto, user)).rejects.toThrow('employee belonging');
    dispute.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(dto, user)).rejects.toThrow('dispute belonging');
    expect(codes.next).not.toHaveBeenCalled();
    await service.create(dto, user);
    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_HR_APPROVAL',
          issuedById: user.id,
          reason: dto.reason,
        }),
      }),
    );
    await service.create({ ...dto, type: 'VERBAL_WARNING' }, user);
    expect(delegate.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });
  it('clears optional dates, links and text while leaving the issue timestamp untouched', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(UpdateDisciplinaryActionDto, {
      effectiveFrom: null,
      effectiveTo: null,
      disputeId: null,
      evidence: null,
      employeeResponse: null,
      notes: null,
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.update('action', dto, user);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          effectiveFrom: null,
          effectiveTo: null,
          disputeId: null,
          evidence: null,
          employeeResponse: null,
          notes: null,
        },
      }),
    );
    await expect(service.update('action', { employeeId: 'other' }, user)).rejects.toThrow(
      'cannot be changed',
    );
    await expect(service.update('action', { effectiveTo: '2025-01-01' }, user)).rejects.toThrow(
      'on or after',
    );
    await expect(
      service.update(
        'action',
        plainToInstance(UpdateDisciplinaryActionDto, { issuedAt: null }),
        user,
      ),
    ).rejects.toThrow('issue date');
    await expect(service.update('action', { status: 'ACTIVE' }, user)).rejects.toThrow(
      'HR approval',
    );
  });
  it('preserves maker-checker and pending-status eligibility including legacy GM rows', async () => {
    const { service, delegate, audit } = setup();
    await expect(service.approve('action', { ...user, id: 'issuer' })).rejects.toThrow(
      'issuer cannot approve',
    );
    expect(delegate.update).not.toHaveBeenCalled();
    delegate.findFirst.mockResolvedValueOnce({ ...record, status: 'ACTIVE' });
    await expect(service.approve('action', user)).rejects.toThrow('not pending');
    delegate.findFirst.mockResolvedValueOnce({ ...record, status: 'PENDING_GM_APPROVAL' });
    await service.approve('action', user);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          approvedById: user.id,
          hrApprovedById: user.id,
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DISCIPLINARY_APPROVE' }),
    );
  });
  it('retains fine deduction linkage and soft-delete behaviour without deleting a deduction', async () => {
    const { service, delegate, deduction, deductionType } = setup();
    delegate.findFirst.mockResolvedValue({
      ...record,
      fineAmount: 10000,
      fineDeductionId: 'deduction',
    });
    expect(await service.applyFine('action', user.id)).toEqual({ id: 'deduction' });
    expect(deduction.create).not.toHaveBeenCalled();
    expect(deductionType.findFirst).not.toHaveBeenCalled();
    await service.remove('action', user);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'action' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
