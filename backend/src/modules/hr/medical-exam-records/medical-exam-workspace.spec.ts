import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { MedicalExamRecordsQueryDto } from '../../../common/dto/resource-query.dto';
import { MedicalExamRecordsService } from './medical-exam-records.service';
import { UpdateMedicalExamRecordDto } from './dto/update-medical-exam-record.dto';
const user: AuthUser = {
  id: 'operator',
  email: 'test@example.invalid',
  roles: [],
  permissions: [],
  companyId: 'company',
  roleScopes: ['COMPANY'],
  companyAccess: [{ companyId: 'additional', accessLevel: 'READ' }],
};
const record = {
  id: 'exam',
  companyId: 'company',
  employeeId: 'employee',
  examDate: new Date('2026-09-01T06:30:00Z'),
  expiresAt: new Date('2027-09-01T06:30:00Z'),
};
function setup() {
  const delegate = {
    findMany: jest.fn().mockResolvedValue([record]),
    count: jest.fn().mockResolvedValue(1),
    findFirst: jest.fn().mockResolvedValue(record),
    create: jest.fn().mockResolvedValue(record),
    update: jest.fn().mockResolvedValue(record),
  };
  const employee = { findFirst: jest.fn().mockResolvedValue({ id: 'employee' }) },
    audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new MedicalExamRecordsService(
    { medicalExamRecord: delegate, employee } as never,
    audit as never,
  );
  return { service, delegate, employee, audit };
}
describe('Medical examination workspace', () => {
  it('validates search input and combines search, scope, expiry, fitness and pagination for rows and count', async () => {
    const { service, delegate } = setup();
    const dto = plainToInstance(MedicalExamRecordsQueryDto, {
      page: '2',
      limit: '20',
      search: ' Alex ',
      companyId: 'company',
      fitnessStatus: 'FIT',
      hazardOnly: 'true',
      expiringDays: '30',
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.findAll(
      {
        page: 2,
        limit: 20,
        search: dto.search,
        companyId: dto.companyId,
        fitnessStatus: dto.fitnessStatus,
        hazardOnly: true,
        expiringDays: 30,
      },
      user,
    );
    const args = delegate.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 20,
      take: 20,
      where: {
        deletedAt: null,
        companyId: 'company',
        fitnessStatus: 'FIT',
        hazardSector: true,
        expiresAt: { lte: expect.any(Date) },
        OR: expect.arrayContaining([
          { employee: { fullName: { contains: 'Alex', mode: 'insensitive' } } },
        ]),
      },
    });
    expect(delegate.count).toHaveBeenCalledWith({ where: args.where });
    await expect(service.findAll({ companyId: 'foreign' }, user)).rejects.toThrow();
    expect(delegate.findMany).toHaveBeenCalledTimes(1);
  });
  it('scopes direct reads, denies unavailable records and enforces write access before mutations', async () => {
    const { service, delegate } = setup();
    await service.findOne('exam', user);
    expect(delegate.findFirst.mock.calls[0][0].where).toEqual({
      id: 'exam',
      deletedAt: null,
      companyId: { in: ['company', 'additional'] },
    });
    delegate.findFirst.mockResolvedValueOnce(null);
    await expect(service.update('foreign', { notes: 'Test' }, user)).rejects.toThrow('not found');
    delegate.findFirst.mockResolvedValue({ ...record, companyId: 'additional' });
    await expect(service.remove('exam', user)).rejects.toThrow();
    expect(delegate.update).not.toHaveBeenCalled();
  });
  it('requires an employee from the writable company before creating and validates date order', async () => {
    const { service, delegate, employee } = setup();
    const dto = {
      companyId: 'company',
      employeeId: 'employee',
      examDate: '2026-09-01',
      expiresAt: '2027-09-01',
    };
    employee.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(dto, user)).rejects.toThrow('belonging');
    expect(delegate.create).not.toHaveBeenCalled();
    await expect(service.create({ ...dto, expiresAt: '2025-01-01' }, user)).rejects.toThrow(
      'Expiry',
    );
    await service.create(dto, user);
    expect(employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'employee', companyId: 'company', deletedAt: null },
      select: { id: true },
    });
    expect(delegate.create).toHaveBeenCalledWith({
      data: { ...dto, examDate: new Date(dto.examDate), expiresAt: new Date(dto.expiresAt) },
    });
  });
  it('clears nullable provider notes without rewriting omitted timestamps and audits the change', async () => {
    const { service, delegate, audit } = setup();
    const dto = plainToInstance(UpdateMedicalExamRecordDto, {
      doctorName: null,
      facilityName: null,
      restrictions: null,
      notes: null,
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    await service.update('exam', dto, user);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'exam' },
      data: { doctorName: null, facilityName: null, restrictions: null, notes: null },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, action: 'UPDATE', oldValue: record }),
    );
  });
  it('rejects reassignment, reversed partial dates and null dates before updating', async () => {
    const { service, delegate } = setup();
    await expect(service.update('exam', { employeeId: 'other' }, user)).rejects.toThrow(
      'cannot be changed',
    );
    await expect(service.update('exam', { expiresAt: '2025-01-01' }, user)).rejects.toThrow(
      'Expiry',
    );
    await expect(
      service.update('exam', plainToInstance(UpdateMedicalExamRecordDto, { examDate: null }), user),
    ).rejects.toThrow('required');
    expect(delegate.update).not.toHaveBeenCalled();
    await service.remove('exam', user);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'exam' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
