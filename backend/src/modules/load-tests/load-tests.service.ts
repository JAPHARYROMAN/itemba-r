import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LoadTestsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, pageSize = 20, environment, status } = query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const where: any = { deletedAt: null };
    if (environment) where.environment = environment;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.loadTestRun.findMany({
        where,
        skip,
        take: Number(pageSize),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.loadTestRun.count({ where }),
    ]);
    return { data, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async findOne(id: string) {
    const record = await this.prisma.loadTestRun.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('Load test run not found');
    return record;
  }

  async create(dto: any, userId: string) {
    return this.prisma.loadTestRun.create({
      data: {
        loadTestNumber: 'LT-' + Date.now(),
        testName: dto.testName,
        environment: dto.environment ?? 'DEVELOPMENT',
        targetUrl: dto.targetUrl ?? null,
        scenarioConfig: dto.scenarioConfig ?? undefined,
        status: 'PLANNED',
        startedById: userId,
        notes: dto.notes ?? null,
      },
    });
  }

  async start(id: string, userId: string) {
    await this.findOne(id);
    return this.prisma.loadTestRun.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date(), startedById: userId },
    });
  }

  async complete(id: string, dto: any) {
    await this.findOne(id);
    return this.prisma.loadTestRun.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultSummary: dto.resultSummary ?? undefined,
        averageResponseTimeMs: dto.averageResponseTimeMs ?? null,
        p95ResponseTimeMs: dto.p95ResponseTimeMs ?? null,
        errorRate: dto.errorRate ?? null,
      },
    });
  }

  async fail(id: string) {
    await this.findOne(id);
    return this.prisma.loadTestRun.update({
      where: { id },
      data: { status: 'FAILED', completedAt: new Date() },
    });
  }

  async cancel(id: string) {
    await this.findOne(id);
    return this.prisma.loadTestRun.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.loadTestRun.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }
}
