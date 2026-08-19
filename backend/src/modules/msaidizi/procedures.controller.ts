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
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConversationsService, mintSessionId, OpenedTurn } from './conversations.service';
import {
  CompileProcedureDto,
  CreateProcedureDto,
  ProcedureRunResult,
  RunProcedureDto,
} from './dto/procedures.dto';
import { ModelMessage } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziService, RunRequest, RunResult } from './msaidizi.service';
import { ProceduresService } from './procedures.service';

/**
 * The wire types moved to `./dto`, and are re-exported here so importers keep
 * naming the controller that serves them. The session-id pattern this file used
 * to declare for itself lives in `dto/session-id.ts` now: it was a copy of the
 * one in `msaidizi.controller.ts`, with a comment on each copy explaining that
 * it was a copy of the other.
 */
export { CompileProcedureDto, CreateProcedureDto, RunProcedureDto } from './dto/procedures.dto';
export type { ProcedureRunResult } from './dto/procedures.dto';

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
   * instruction, never an approval. Bounded to the capability list it was
   * approved with, intersected with what the invoker may actually reach.
   *
   * Returns a `ProcedureRunResult`: the run, plus which conversation and turn it
   * landed in. This endpoint accepts `sessionId` and `confirmed`, so it is a
   * resumable surface, and a caller that is never told where its run was filed
   * cannot tell an approvable red-tier proposal from one no grant was issued for.
   */
  @Post(':id/run')
  @RequirePermissions('msaidizi.use')
  async run(
    @Param('id') id: string,
    @Body() dto: RunProcedureDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
  ): Promise<ProcedureRunResult> {
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

    // `conversationId` and `turnSequence` are what let the loop issue a grant
    // when it proposes a red-tier step and spend one when it dispatches: a grant
    // belongs to a conversation and a user, and the loop cannot name either
    // without being told. Both come from `opened` — the conversation the store
    // resolved — and never from the request, so an approval's scope is never a
    // thread the caller merely named.
    const request: RunRequest = {
      user,
      authorization,
      // The session id the store settled on, never one minted here — it is the
      // audit key every `audit_logs` row this run writes is stamped with, and
      // the store is the only thing that has resolved it against this caller's
      // own conversations.
      sessionId: opened.sessionId,
      conversationId: opened.conversationId,
      turnSequence: opened.sequence,
      confirmed: dto.confirmed,
      restrictTo: entries,
      messages: this.messagesFor(message, opened),
    };
    const result = await this.agent.run(request);

    await this.recordQuietly(opened, result);
    // Spread rather than mutated: `close()` was handed `result` itself, and the
    // run result is not this controller's object to rewrite after the fact.
    // Both fields are absent, never zero, for a turn that was not persisted.
    return { ...result, conversationId: opened.conversationId, sequence: opened.sequence };
  }

  /**
   * Opens the run's row, and can never be the reason a procedure does not run.
   *
   * A plain invocation carries no session id, so `open()` mints one and the run
   * starts a conversation of its own. An APPROVAL carries the session id of the
   * run it is approving, and that id is how the approval gets back into the
   * conversation the proposal was made in — a grant is issued against a
   * conversation and spendable only from it, so a run that starts a new
   * conversation finds no grant matching what the user approved and proposes the
   * action again. This controller used to pass no id at all, which made that
   * loop unbreakable from the API while a comment two methods up claimed the
   * opposite.
   *
   * Sending an id is not sending a conversation. `open()` resolves it against
   * the caller's own rows, and an id resolving to nothing they own is IGNORED in
   * favour of a freshly minted one — never adopted, so a procedure run cannot be
   * filed into another user's audit trail, and never rejected, because failing a
   * run over a stale id is a worse outcome than re-identifying it.
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
      if (clientSessionId) {
        this.logger.warn(
          `Session id ${clientSessionId} could not be checked against this caller's conversations ` +
            `(the turn could not be opened), so it was ignored and a fresh one minted; this ` +
            `procedure run is unpersisted and any red-tier step will be proposed again.`,
        );
      }
      // A FRESH id, never the client's. The provenance rule holds at this door
      // too: an id from the request is honoured only where it can be RESOLVED to
      // a conversation this caller owns, and `open()` threw before any row could
      // be read. This used to adopt it, because red-tier ids were DERIVED from
      // the session id and minting one broke an approval in flight; approvals are
      // server-issued grants now, and an unpersisted run has no conversation to
      // spend one from regardless — so the step re-proposes, which is the
      // fail-closed outcome rather than a regression.
      //
      // No `sequence`: this turn has no position in any stored conversation.
      return {
        sessionId: mintSessionId(),
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
