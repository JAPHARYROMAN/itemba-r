import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { applyCompanyScopeWhere } from '../../common/services';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalStepDto } from './dto/create-approval-step.dto';
import { UpdateApprovalStepDto } from './dto/update-approval-step.dto';

@Injectable()
export class ApprovalStepsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findByWorkflow(workflowId: string, user: any) {
    const steps = await this.prisma.approvalStep.findMany({
      where: { workflowId },
      orderBy: { stepOrder: 'asc' },
    });
    return { data: steps, total: steps.length };
  }

  async findOne(id: string, user: any) {
    const where: Record<string, unknown> = { id };
    if (user) applyCompanyScopeWhere(where, user, null);
    const record = await this.prisma.approvalStep.findFirst({ where });
    if (!record) throw new NotFoundException('Approval step not found');
    return record;
  }

  async create(workflowId: string, dto: CreateApprovalStepDto, user: any) {
    const workflow = await this.prisma.approvalWorkflow.findFirst({ where: { id: workflowId } });
    if (!workflow) throw new NotFoundException('Approval workflow not found');
    const record = await this.prisma.approvalStep.create({
      data: { ...dto, workflowId } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ApprovalStep', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateApprovalStepDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalStep.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalStep', entityId: id, newValue: dto as any });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.approvalStep.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ApprovalStep', entityId: id, newValue: {} });
    return { message: 'Approval step deleted' };
  }
}
