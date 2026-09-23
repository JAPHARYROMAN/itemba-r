import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceDraft } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EncryptionService } from '../../common/services/encryption.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceService } from './workspace.service';
import { DraftContent, WorkspaceDraftPolicy } from './workspace-draft-policy';
import { boundedJson, identifier, object, revision } from './workspace.validation';

const LEASE_MS = 60000;
const tokenHash = (token: unknown) => createHash('sha256').update(identifier(token)).digest('hex');
@Injectable()
export class WorkspaceDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly workspace: WorkspaceService,
    private readonly policy: WorkspaceDraftPolicy,
  ) {}
  private content(row: WorkspaceDraft): DraftContent {
    return JSON.parse(this.encryption.decrypt(row.encryptedContent));
  }
  private async readable(user: AuthUser, row: WorkspaceDraft) {
    const content = this.content(row);
    const scope = await this.policy.authorize(user, row.appId, row.formType, content);
    if (
      scope.companyId !== row.companyId ||
      scope.divisionId !== row.divisionId ||
      scope.branchId !== row.branchId
    )
      throw new ForbiddenException(
        'The draft organisation changed. Review the source with your administrator.',
      );
    return {
      id: row.id,
      appId: row.appId,
      formType: row.formType,
      schemaVersion: row.schemaVersion,
      revision: row.revision,
      ...content,
      needsReview: true,
      updatedAt: row.updatedAt.getTime(),
      leased: !!row.leaseUntil && row.leaseUntil > new Date(),
    };
  }
  async list(user: AuthUser) {
    const rows = await this.prisma.workspaceDraft.findMany({
      where: { userId: this.workspace.owner(user) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const result = [];
    for (const row of rows) {
      try {
        result.push(await this.readable(user, row));
      } catch (error) {
        if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException))
          throw error;
      }
    }
    return result;
  }
  async get(user: AuthUser, id: string) {
    const row = await this.prisma.workspaceDraft.findFirst({
      where: { id: identifier(id), userId: this.workspace.owner(user) },
    });
    if (!row) throw new NotFoundException('Draft unavailable');
    return this.readable(user, row);
  }
  async save(user: AuthUser, id: string, input: unknown) {
    const userId = this.workspace.owner(user),
      dto = object(input);
    identifier(id);
    const expected = revision(dto.expectedRevision),
      hash = tokenHash(dto.leaseToken);
    const payload = object(dto.content);
    boundedJson(payload, 200000);
    if (
      typeof payload.title !== 'string' ||
      payload.title.length > 160 ||
      (payload.summary && (typeof payload.summary !== 'string' || payload.summary.length > 160)) ||
      (payload.requestId !== null && typeof payload.requestId !== 'string')
    )
      throw new BadRequestException('Invalid draft content');
    if (Object.values(object(payload.context)).some((value) => typeof value !== 'string'))
      throw new BadRequestException('Invalid draft context');
    if (dto.schemaVersion !== 1) throw new BadRequestException('Unsupported draft version');
    const content: DraftContent = {
      title: payload.title,
      summary: payload.summary,
      context: payload.context,
      values: object(payload.values),
      requestId: payload.requestId,
      needsReview: true,
      submission: payload.submission === 'uncertain' ? 'uncertain' : null,
    };
    const scope = await this.policy.authorize(user, dto.appId, dto.formType, content);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-draft:${userId}`}))`;
      const old = await tx.workspaceDraft.findUnique({ where: { id } });
      if (old && old.userId !== userId) throw new NotFoundException();
      if (
        (old?.revision ?? 0) !== expected ||
        (old && (old.leaseToken !== hash || !old.leaseUntil || old.leaseUntil <= new Date()))
      )
        throw new ConflictException(
          'Draft changed or is being edited elsewhere. Your local changes have been kept in this window.',
        );
      if (old) {
        await this.readable(user, old);
        if (old.appId !== dto.appId || old.formType !== dto.formType)
          throw new BadRequestException('A draft cannot change form type');
        const previous = this.content(old);
        if (previous.requestId && previous.requestId !== content.requestId)
          throw new ConflictException('The original transaction identity must be retained');
        if (previous.submission === 'uncertain') content.submission = 'uncertain';
      } else if ((await tx.workspaceDraft.count({ where: { userId } })) >= 200)
        throw new BadRequestException(
          'You have 200 saved drafts. Finish or discard a draft first.',
        );
      const data = {
        ...scope,
        encryptedContent: this.encryption.encrypt(JSON.stringify(content)),
        leaseToken: hash,
        leaseUntil: new Date(Date.now() + LEASE_MS),
      };
      const row = await tx.workspaceDraft.upsert({
        where: { id },
        create: { id, userId, appId: dto.appId, formType: dto.formType, schemaVersion: 1, ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      return {
        id,
        revision: row.revision,
        updatedAt: row.updatedAt.getTime(),
        leaseUntil: row.leaseUntil,
      };
    });
  }
  async lease(user: AuthUser, id: string, input: unknown) {
    const userId = this.workspace.owner(user),
      dto = object(input),
      hash = tokenHash(dto.leaseToken),
      expected = revision(dto.expectedRevision);
    identifier(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-draft:${userId}`}))`;
      const row = await tx.workspaceDraft.findFirst({ where: { id, userId } });
      if (!row) throw new NotFoundException();
      await this.readable(user, row);
      if (
        row.revision !== expected ||
        (row.leaseUntil && row.leaseUntil > new Date() && row.leaseToken !== hash)
      )
        throw new ConflictException('This draft is open in another window or device');
      const releasing = dto.release === true;
      if (releasing && row.leaseToken !== hash)
        throw new ConflictException('Lease belongs to another editor');
      const leaseUntil = releasing ? null : new Date(Date.now() + LEASE_MS);
      await tx.workspaceDraft.update({
        where: { id },
        data: { leaseToken: releasing ? null : hash, leaseUntil },
      });
      return { revision: row.revision, leaseUntil };
    });
  }
  async discard(user: AuthUser, id: string, input: unknown) {
    const userId = this.workspace.owner(user),
      dto = object(input),
      expected = revision(dto.expectedRevision);
    identifier(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-draft:${userId}`}))`;
      const row = await tx.workspaceDraft.findFirst({ where: { id, userId } });
      if (!row) return { removed: true };
      await this.readable(user, row);
      if (
        row.revision !== expected ||
        (row.leaseUntil &&
          row.leaseUntil > new Date() &&
          row.leaseToken !== tokenHash(dto.leaseToken))
      )
        throw new ConflictException('Draft changed elsewhere. Reload before discarding it.');
      await tx.workspaceDraft.delete({ where: { id } });
      return { removed: true };
    });
  }
}
