import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const SOFT_DELETE_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'deletedAt'))
    .map((model) => model.name),
);

const READ_ACTIONS = new Set(['findFirst', 'findMany', 'count', 'aggregate', 'groupBy']);

function hasDeletedAtFilter(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) return true;

  const record = where as Record<string, unknown>;
  return ['AND', 'OR', 'NOT'].some((key) => {
    const value = record[key];
    if (Array.isArray(value)) return value.some((item) => hasDeletedAtFilter(item));
    return hasDeletedAtFilter(value);
  });
}

function withLiveRecordFilter(where: unknown) {
  if (!where || typeof where !== 'object') return { deletedAt: null };
  if (hasDeletedAtFilter(where)) return where;
  return { AND: [where, { deletedAt: null }] };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    this.$use(async (params, next) => {
      if (!params.model || !SOFT_DELETE_MODELS.has(params.model)) return next(params);

      params.args ??= {};
      if (params.action === 'findUnique') {
        params.action = 'findFirst';
        params.args.where = withLiveRecordFilter(params.args.where);
      } else if (READ_ACTIONS.has(params.action)) {
        params.args.where = withLiveRecordFilter(params.args.where);
      } else if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = { ...(params.args.data ?? {}), deletedAt: new Date() };
      } else if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args.data = { ...(params.args.data ?? {}), deletedAt: new Date() };
      } else if (params.action === 'updateMany') {
        params.args.where = withLiveRecordFilter(params.args.where);
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
