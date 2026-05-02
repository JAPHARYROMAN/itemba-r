import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JobQueueConfigsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.jobQueueConfig.findMany({ orderBy: { queueName: 'asc' } });
  }

  async findOne(id: string) {
    const record = await this.prisma.jobQueueConfig.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Job queue config not found');
    return record;
  }

  async create(dto: any) {
    return this.prisma.jobQueueConfig.create({
      data: {
        queueName: dto.queueName,
        description: dto.description ?? null,
        concurrency: dto.concurrency ?? 1,
        retryAttempts: dto.retryAttempts ?? 3,
        retryBackoffSeconds: dto.retryBackoffSeconds ?? 60,
        timeoutSeconds: dto.timeoutSeconds ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: any) {
    await this.findOne(id);
    return this.prisma.jobQueueConfig.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.concurrency !== undefined && { concurrency: dto.concurrency }),
        ...(dto.retryAttempts !== undefined && { retryAttempts: dto.retryAttempts }),
        ...(dto.retryBackoffSeconds !== undefined && { retryBackoffSeconds: dto.retryBackoffSeconds }),
        ...(dto.timeoutSeconds !== undefined && { timeoutSeconds: dto.timeoutSeconds }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async setActive(id: string, isActive: boolean) {
    await this.findOne(id);
    return this.prisma.jobQueueConfig.update({ where: { id }, data: { isActive } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.jobQueueConfig.delete({ where: { id } });
    return { success: true };
  }
}
