/**
 * Saved procedures — a task taught once, reviewed once, then invoked by name.
 *
 * The alternative is re-deriving the task from prose on every run. That is
 * unreviewable before the fact, varies between runs, and hands the agent the
 * full breadth of the invoker's permissions for a job that needs a handful of
 * capabilities. A saved procedure inverts all three: it is reviewed before first
 * use, it runs the same way each time, and it is bounded to the capability list
 * it was approved with.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 *   1. **The invoker's permissions apply, not the author's.** A procedure is a
 *      saved instruction, never a grant. If a clerk runs a procedure a director
 *      wrote, it does what the clerk is allowed to do and no more — otherwise
 *      procedures would become a way to launder authority.
 *
 *   2. **The approved capability list is a ceiling, not a snapshot to refresh.**
 *      A procedure approved last month must not silently widen because a new
 *      endpoint appeared, so the stored list is intersected with the invoker's
 *      current permissions rather than recomputed from the manifest.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, MsaidiziProcedureStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService, companyWhereForUser } from '../../common/services';
import { ReversibilityTier, TIER_RANK } from '../../common/capabilities/reversibility';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { narrowCapabilities } from './domain-filter';
import { ManifestProvider } from './manifest.provider';
import { MsaidiziConfig } from './msaidizi.config';
import { buildRegistry, RegistryEntry } from './tool-registry';

export interface CompiledProcedure {
  /** Tool names the instruction resolved to. */
  capabilities: string[];
  /** Highest tier among them — the blast radius, shown to the reviewer. */
  highestTier: ReversibilityTier;
  /** Capabilities with their descriptions, so a human can actually review it. */
  preview: Array<{ tool: string; description: string; tier: ReversibilityTier; path: string }>;
}

@Injectable()
export class ProceduresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manifest: ManifestProvider,
    private readonly config: MsaidiziConfig,
    private readonly companyScope: CompanyScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Resolves an instruction to the capabilities a run would be allowed to use.
   *
   * Deliberately computed from the author's *current* permissions and the
   * deployment's write mode, so a reviewer sees a concrete, bounded list rather
   * than a promise. Compilation never saves anything — the caller reviews the
   * result and then creates the procedure if it looks right.
   */
  compile(instruction: string, user: AuthUser): CompiledProcedure {
    const candidates = buildRegistry(
      this.manifest.capabilities(),
      user.permissions ?? [],
      this.config.allowedTiers,
    );

    const relevant = selectForInstruction(candidates, instruction);
    if (relevant.length === 0) {
      throw new BadRequestException(
        'No capabilities you hold match that instruction. Rephrase it using the names of the records involved, or ask for the access you need.',
      );
    }

    return {
      capabilities: relevant.map((e) => e.tool.name),
      highestTier: highestTierOf(relevant),
      preview: relevant.map((e) => ({
        tool: e.tool.name,
        description: e.tool.description,
        tier: e.capability.tier,
        path: `${e.capability.verb} /${e.capability.path}`,
      })),
    };
  }

  async create(
    input: { name: string; instruction: string; companyId?: string; capabilities: string[] },
    user: AuthUser,
  ) {
    await this.companyScope.assertCanAccessCompany(
      user,
      input.companyId ?? null,
      AccessLevel.WRITE,
    );

    // Never trust a client-supplied capability list: re-derive what the author
    // may actually reach and intersect. Otherwise "saving a procedure" would be
    // a way to name capabilities you were never granted.
    const allowed = new Set(
      buildRegistry(
        this.manifest.capabilities(),
        user.permissions ?? [],
        this.config.allowedTiers,
      ).map((e) => e.tool.name),
    );
    const capabilities = input.capabilities.filter((name) => allowed.has(name));
    if (capabilities.length === 0) {
      throw new BadRequestException('None of the requested capabilities are available to you.');
    }

    const entries = this.entriesFor(capabilities, user);

    const record = await this.prisma.msaidiziProcedure.create({
      data: {
        companyId: input.companyId ?? null,
        name: input.name,
        instruction: input.instruction,
        capabilities: capabilities as unknown as Prisma.InputJsonValue,
        highestTier: highestTierOf(entries),
        status: MsaidiziProcedureStatus.DRAFT,
        createdById: user.id,
      },
    });

    await this.audit.log({
      userId: user.id,
      companyId: input.companyId,
      action: 'MSAIDIZI_PROCEDURE_CREATE',
      entityType: 'MsaidiziProcedure',
      entityId: record.id,
      newValue: { name: input.name, capabilities, highestTier: record.highestTier },
    });

    return record;
  }

  /**
   * Approves a procedure for use.
   *
   * Separate from creation on purpose: the point of a saved procedure is that
   * somebody looked at the capability list before it could run. Creating and
   * approving in one call would remove the only review step there is.
   */
  async activate(id: string, user: AuthUser) {
    const procedure = await this.findOne(id, user);
    if (procedure.status === MsaidiziProcedureStatus.ARCHIVED) {
      throw new BadRequestException('An archived procedure cannot be reactivated.');
    }

    // Maker-checker, matching the approval engine's existing rule. Without it,
    // "reviewed before it can run" reduces to the author agreeing with
    // themselves, which is not a review — and a procedure is precisely the
    // artefact where an unreviewed capability list does lasting damage, because
    // it is invoked repeatedly by people who never saw it compiled.
    if (procedure.createdById === user.id) {
      throw new ForbiddenException(
        'A procedure must be approved by someone other than its author.',
      );
    }

    const updated = await this.prisma.msaidiziProcedure.update({
      where: { id },
      data: {
        status: MsaidiziProcedureStatus.ACTIVE,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });

    await this.audit.log({
      userId: user.id,
      companyId: procedure.companyId ?? undefined,
      action: 'MSAIDIZI_PROCEDURE_ACTIVATE',
      entityType: 'MsaidiziProcedure',
      entityId: id,
      oldValue: { status: procedure.status },
      newValue: { status: MsaidiziProcedureStatus.ACTIVE },
    });

    return updated;
  }

  async archive(id: string, user: AuthUser) {
    const procedure = await this.findOne(id, user);
    const updated = await this.prisma.msaidiziProcedure.update({
      where: { id },
      data: { status: MsaidiziProcedureStatus.ARCHIVED },
    });
    await this.audit.log({
      userId: user.id,
      companyId: procedure.companyId ?? undefined,
      action: 'MSAIDIZI_PROCEDURE_ARCHIVE',
      entityType: 'MsaidiziProcedure',
      entityId: id,
    });
    return updated;
  }

  async findAll(user: AuthUser, companyId?: string) {
    return this.prisma.msaidiziProcedure.findMany({
      where: {
        ...companyWhereForUser(user, companyId),
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.msaidiziProcedure.findFirst({
      where: {
        id,
        ...companyWhereForUser(user),
        deletedAt: null,
      },
    });
    if (!record) throw new NotFoundException('Procedure not found.');
    return record;
  }

  /**
   * Resolves a procedure into the tool set a run may use.
   *
   * The stored list is a ceiling and the invoker's permissions are a second
   * ceiling; a run gets the intersection. If that intersection is empty the
   * procedure is refused rather than silently doing part of the job — a
   * half-executed procedure is worse than one that did not start.
   */
  async resolveForRun(
    id: string,
    user: AuthUser,
  ): Promise<{ instruction: string; entries: RegistryEntry[] }> {
    const procedure = await this.findOne(id, user);

    if (procedure.status !== MsaidiziProcedureStatus.ACTIVE) {
      throw new ForbiddenException(
        procedure.status === MsaidiziProcedureStatus.DRAFT
          ? 'This procedure has not been reviewed and approved yet.'
          : 'This procedure has been archived.',
      );
    }

    const declared = new Set(procedure.capabilities as unknown as string[]);
    const entries = buildRegistry(
      this.manifest.capabilities(),
      user.permissions ?? [],
      this.config.allowedTiers,
    ).filter((e) => declared.has(e.tool.name));

    if (entries.length === 0) {
      throw new ForbiddenException(
        'You do not have access to any of the actions this procedure needs.',
      );
    }

    return { instruction: procedure.instruction, entries };
  }

  private entriesFor(toolNames: string[], user: AuthUser): RegistryEntry[] {
    const wanted = new Set(toolNames);
    return buildRegistry(
      this.manifest.capabilities(),
      user.permissions ?? [],
      this.config.allowedTiers,
    ).filter((e) => wanted.has(e.tool.name));
  }
}

function highestTierOf(entries: RegistryEntry[]): ReversibilityTier {
  return entries.reduce<ReversibilityTier>(
    (worst, e) => (TIER_RANK[e.capability.tier] > TIER_RANK[worst] ? e.capability.tier : worst),
    'green',
  );
}

/**
 * Picks the capabilities an instruction plausibly needs.
 *
 * Reuses the same lexical narrowing the live agent uses, so what a reviewer
 * approves is drawn from the same pool a run would draw from. Capped well below
 * the live budget: a procedure that needs dozens of capabilities is not a
 * procedure, it is the whole agent, and should be run as one.
 */
function selectForInstruction(candidates: RegistryEntry[], instruction: string): RegistryEntry[] {
  const chosen = new Set(
    narrowCapabilities(
      candidates.map((e) => e.capability),
      instruction,
      { limit: 12 },
    ).map((c) => c.id),
  );
  return candidates.filter((e) => chosen.has(e.capability.id));
}
