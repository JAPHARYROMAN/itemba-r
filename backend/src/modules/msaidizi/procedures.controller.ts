import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConversationsService, mintSessionId, OpenedTurn } from './conversations.service';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziService, RunResult } from './msaidizi.service';
import { ProceduresService } from './procedures.service';

/**
 * The shape `mintSessionId()` mints: `ms_` and a UUID with its dashes removed.
 * Declared here rather than exported from `conversations.service` so the DTO
 * layer does not import the store, but it is the same alphabet and the same
 * length, and `msaidizi.controller.ts` pins `AskDto.sessionId` to a copy of it.
 */
const SESSION_ID = /^ms_[0-9a-f]{32}$/;

export class CompileProcedureDto {
  @IsString() @MinLength(4) @MaxLength(4000) instruction!: string;
}

export class CreateProcedureDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(4) @MaxLength(4000) instruction!: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsArray() @IsString({ each: true }) capabilities!: string[];
}

export class RunProcedureDto {
  /** Extra context for this run — "for supplier X", "for March". */
  @IsOptional() @IsString() @MaxLength(2000) context?: string;

  /**
   * The session id of the run being approved, echoed back from its `RunResult`.
   *
   * Sent only with `confirmed`, and it is what makes an approval possible at
   * all. `confirmationIdFor()` derives every red-tier id from the session id, so
   * a second run under a fresh id recomputes ids that cannot match the ones the
   * user just approved: the run suspends again, on the same action, with the
   * same buttons, forever. Omitting it starts a new run, which is what a plain
   * invocation wants.
   *
   * Pinned to the shape `mintSessionId()` produces, and that is a constraint on
   * an AUDIT key rather than tidiness about strings. Whatever arrives here is
   * what `open()` settles on when it resolves to nothing of this caller's, what
   * the agent runs under, and what `capability-invoker` sends as the
   * agent-session header every `audit_logs` row this run writes is stamped with.
   *
   * The pattern constrains SHAPE only. It rejects a hand-written or copied
   * string; it cannot tell an id this server issued from one a client invented
   * in the same alphabet, and nothing at this layer can. The threat named above
   * — a run filed under a session id read somewhere else — is closed by the
   * unique index on `agentSessionId` instead: an id that already names a
   * conversation is rejected on insert and the run is given a freshly minted one
   * (`conversations.service.ts`, `startConversation`). Echoing back an id this
   * server minted is always honoured; borrowing someone else's never is.
   */
  @IsOptional() @IsString() @Matches(SESSION_ID) sessionId?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
}

/**
 * Saved procedures.
 *
 * `@AgentExcluded` for the same reason as the ask endpoints: a procedure run
 * must not be able to author or approve procedures, which would let it widen its
 * own bounds mid-run.
 */
@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@Controller('msaidizi/procedures')
export class ProceduresController {
  private readonly logger = new Logger(ProceduresController.name);

  constructor(
    private readonly procedures: ProceduresService,
    private readonly agent: MsaidiziService,
    private readonly conversations: MsaidiziConversationsService,
    private readonly config: MsaidiziConfig,
  ) {}

  /**
   * Resolves an instruction to the capabilities a run would be allowed to use,
   * without saving anything. This is the review step — the caller looks at the
   * list, then calls create with it.
   */
  @Post('compile')
  @RequirePermissions('msaidizi.procedures.manage')
  compile(@Body() dto: CompileProcedureDto, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.compile(dto.instruction, user);
  }

  @Post()
  @RequirePermissions('msaidizi.procedures.manage')
  create(@Body() dto: CreateProcedureDto, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.create(dto, user);
  }

  /** Approve a procedure for use. Deliberately separate from creation. */
  @Patch(':id/activate')
  @RequirePermissions('msaidizi.procedures.approve')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.activate(id, user);
  }

  @Patch(':id/archive')
  @RequirePermissions('msaidizi.procedures.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.archive(id, user);
  }

  @Get()
  @RequirePermissions('msaidizi.procedures.view')
  findAll(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.procedures.findAll(user, companyId);
  }

  @Get(':id')
  @RequirePermissions('msaidizi.procedures.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.procedures.findOne(id, user);
  }

  /**
   * Runs a procedure.
   *
   * Under the *invoker's* permissions, not the author's — a procedure is a saved
   * instruction, never a grant. Bounded to the capability list it was approved
   * with, intersected with what the invoker may actually reach.
   */
  @Post(':id/run')
  @RequirePermissions('msaidizi.use')
  async run(
    @Param('id') id: string,
    @Body() dto: RunProcedureDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
  ): Promise<RunResult> {
    this.assertEnabled();
    if (!authorization) {
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    const { instruction, entries } = await this.procedures.resolveForRun(id, user);
    const message = dto.context ? `${instruction}\n\nFor this run: ${dto.context}` : instruction;

    // Opened before the loop, for the same reason the ask path opens before it:
    // a run that dies mid-loop has still left a row saying it happened, carrying
    // the session id its audit entries are stamped with. `procedureId` is what
    // makes that row say WHICH procedure ran — and an unattributed agent action
    // matters most here, because this is the one a human pre-approved.
    const opened = await this.openTurn(message, id, user, dto.sessionId);

    const result = await this.agent.run({
      user,
      authorization,
      // The session id the store settled on, never one minted here. Red-tier
      // confirmation ids are derived from it, and a second id in play is the
      // infinite approval loop.
      sessionId: opened.sessionId,
      confirmed: dto.confirmed,
      restrictTo: entries,
      messages: this.messagesFor(message, opened),
    });

    await this.recordQuietly(opened, result);
    return result;
  }

  /**
   * Opens the run's row, and can never be the reason a procedure does not run.
   *
   * A plain invocation carries no session id, so `open()` mints one and the run
   * starts a conversation of its own. An APPROVAL carries the session id of the
   * run it is approving, and that id has to survive: red-tier confirmation ids
   * are derived from it, so a fresh one here recomputes every id and none of
   * them match what the user approved — the run suspends on the same action
   * again, and every attempt leaves another conversation row behind. This
   * controller used to pass neither, which made that loop unbreakable from the
   * API while a comment two methods up claimed the opposite.
   *
   * Sending an id is not sending a conversation: `open()` resolves it against
   * the caller's own rows and starts a fresh conversation under it if it
   * resolves to nothing they own, so an id belonging to someone else collides on
   * the unique index — and that run then proceeds unpersisted under an id minted
   * for it, never under the borrowed one, so a procedure run cannot be filed
   * into another user's audit trail.
   *
   * No `conversationId` is accepted, so there is still no 404/409/410 to
   * propagate. The `HttpException` re-throw is kept anyway, because it costs
   * nothing and this controller must not become the place that swallows an
   * answer `open()` deliberately gave.
   */
  private async openTurn(
    prompt: string,
    procedureId: string,
    user: AuthUser,
    clientSessionId?: string,
  ): Promise<OpenedTurn> {
    try {
      return await this.conversations.open({ user, prompt, procedureId, clientSessionId });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Could not open a conversation turn for procedure ${procedureId}; ` +
          `running unpersisted: ${(err as Error)?.message}`,
      );
      // The client's own id when it sent one, so an approval that arrives while
      // the store is down still recomputes the ids it approved. No `sequence`:
      // this turn has no position in any stored conversation to report.
      return {
        sessionId: clientSessionId ?? mintSessionId(),
        history: [],
        fromServer: false,
        priorTier: 'green',
      };
    }
  }

  /**
   * The conversation as the model should receive it.
   *
   * `opened.history` is empty on a plain invocation — a procedure run is a fresh
   * conversation — and carries the suspended run's messages on an approval,
   * because `open()` resolves the echoed session id to that conversation and
   * hands back its stored working state. That is what the model needs in order
   * to re-issue the action it proposed rather than reason about the instruction
   * from scratch, and it is why this spreads rather than replaces.
   */
  private messagesFor(message: string, opened: OpenedTurn): ModelMessage[] {
    return [...opened.history, { role: 'user', content: message }];
  }

  /**
   * Records the finished run, and can never fail it.
   *
   * By the time this is reached every tool call has already executed against the
   * caller's own data and whatever the procedure changed is in `audit_logs`.
   * Turning a failed history write into a 500 would tell the user their run
   * failed when it did not, and under a write mode would hide that it succeeded.
   * Mirrors `MsaidiziController.recordQuietly`; `close()` also swallows
   * internally, and the property is load-bearing enough to hold at both ends.
   */
  private async recordQuietly(opened: OpenedTurn, result: RunResult): Promise<void> {
    try {
      await this.conversations.close(opened, result);
    } catch (err) {
      this.logger.error(
        `Failed to record procedure run ${result.sessionId} on conversation ` +
          `${opened.conversationId ?? '(unpersisted)'}: ${(err as Error)?.message}`,
      );
    }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
  }
}
