import { NotFoundException } from '@nestjs/common';
import { ApprovalStepsService } from './approval-steps.service';

function makeService(prismaOverrides: any = {}) {
  const audit = { log: jest.fn() } as any;
  const prisma = {
    approvalStep: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    approvalWorkflow: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ...prismaOverrides,
  } as any;
  const service = new ApprovalStepsService(prisma, audit);
  return { service, prisma, audit };
}

const normalUser: any = {
  id: 'user-1',
  companyId: 'company-1',
  roleScopes: [],
  companyAccess: [{ companyId: 'company-1', accessLevel: 'MANAGE' }],
};

describe('ApprovalStepsService company scoping (via parent workflow)', () => {
  it('findOne scopes through the workflow relation, never a top-level companyId (ApprovalStep has no companyId)', async () => {
    const { service, prisma } = makeService({
      approvalStep: {
        findFirst: jest.fn().mockResolvedValue({ id: 'step-1', workflowId: 'wf-1' }),
      },
    });

    const result = await service.findOne('step-1', normalUser);

    expect(result).toEqual({ id: 'step-1', workflowId: 'wf-1' });
    const where = prisma.approvalStep.findFirst.mock.calls[0][0].where;
    // The invalid top-level companyId filter must be gone...
    expect(where).not.toHaveProperty('companyId');
    expect(where.id).toBe('step-1');
    // ...replaced by a workflow relation filter carrying the company scope.
    expect(where.workflow).toEqual({ is: { companyId: { in: ['company-1'] } } });
  });

  it('update no longer crashes and resolves the step via the workflow-scoped findOne', async () => {
    const { service, prisma } = makeService({
      approvalStep: {
        findFirst: jest.fn().mockResolvedValue({ id: 'step-1', workflowId: 'wf-1' }),
        update: jest.fn().mockResolvedValue({ id: 'step-1', stepName: 'Updated' }),
      },
    });

    const result = await service.update('step-1', { stepName: 'Updated' } as any, normalUser);

    expect(result).toEqual({ id: 'step-1', stepName: 'Updated' });
    // findOne lookup carried the relation filter, not a bare companyId.
    const findWhere = prisma.approvalStep.findFirst.mock.calls[0][0].where;
    expect(findWhere).not.toHaveProperty('companyId');
    expect(findWhere.workflow).toEqual({ is: { companyId: { in: ['company-1'] } } });
    expect(prisma.approvalStep.update).toHaveBeenCalledWith({
      where: { id: 'step-1' },
      data: { stepName: 'Updated' },
    });
  });

  it('remove no longer crashes and deletes after a workflow-scoped lookup', async () => {
    const { service, prisma } = makeService({
      approvalStep: {
        findFirst: jest.fn().mockResolvedValue({ id: 'step-1', workflowId: 'wf-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'step-1' }),
      },
    });

    const result = await service.remove('step-1', normalUser);

    expect(result).toEqual({ message: 'Approval step deleted' });
    const findWhere = prisma.approvalStep.findFirst.mock.calls[0][0].where;
    expect(findWhere).not.toHaveProperty('companyId');
    expect(prisma.approvalStep.delete).toHaveBeenCalledWith({ where: { id: 'step-1' } });
  });

  it('findOne throws NotFound when the step belongs to another company (relation filter excludes it)', async () => {
    const { service } = makeService({
      approvalStep: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.findOne('foreign-step', normalUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findByWorkflow scopes listing through the workflow relation', async () => {
    const { service, prisma } = makeService({
      approvalStep: { findMany: jest.fn().mockResolvedValue([{ id: 'step-1' }]) },
    });

    await service.findByWorkflow('wf-1', normalUser);

    const where = prisma.approvalStep.findMany.mock.calls[0][0].where;
    expect(where.workflowId).toBe('wf-1');
    expect(where.workflow).toEqual({ is: { companyId: { in: ['company-1'] } } });
    expect(where).not.toHaveProperty('companyId');
  });

  it('create scopes the parent workflow lookup and rejects a workflow outside the user company', async () => {
    const { service, prisma } = makeService({
      approvalWorkflow: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.create('wf-other', { stepOrder: 1, stepName: 'S1' } as any, normalUser),
    ).rejects.toBeInstanceOf(NotFoundException);

    const where = prisma.approvalWorkflow.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('wf-other');
    expect(where.companyId).toEqual({ in: ['company-1'] });
  });
});
