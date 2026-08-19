import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Logger,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConversationsService, mintSessionId, OpenedTurn } from './conversations.service';
import { AskDto, AskResult } from './dto/ask.dto';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziCapabilities, MsaidiziService, RunRequest, RunResult } from './msaidizi.service';
import { ModelMessage } from './model-client';

/**
 * The wire types moved to `./dto`, and are re-exported here so that every
 * importer — the specs, the swagger metadata, anything reaching for the shape of
 * this endpoint — keeps naming the controller that serves them. They live in
 * their own directory because `AskDto.confirmed` and `RunProcedureDto.confirmed`
 * now share a grant-id pattern with the mint that produces it, and a constant
 * shared between two controllers has nowhere honest to live inside either.
 */
export { AskDto, ConversationMessageDto } from './dto/ask.dto';
export type { AskResult } from './dto/ask.dto';

/**
 * Msaidizi's own surface.
 *
 * `@AgentExcluded` on the controller keeps these routes out of the capability
 * registry, so a run cannot invoke Msaidizi recursively — the agent is not one
 * of its own tools.
 */
@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@Controller('msaidizi')
export class MsaidiziController {
  private readonly logger = new Logger(MsaidiziController.name);

  constructor(
    private readonly service: MsaidiziService,
    private readonly conversations: MsaidiziConversationsService,
    private readonly config: MsaidiziConfig,
  ) {}

  /**
   * What this caller's agent can reach, and under what ceilings.
   *
   * A GET, and deliberately NOT gated on `enabled`: a client has to be able to
   * learn the feature is switched off without firing a run and reading a 503.
   * `capabilitiesFor` reports, it does not act — there is no bearer-token
   * requirement here because nothing is invoked on the caller's behalf.
   *
   * The UI needs this for two things it cannot otherwise know: which mode
   * banner to show (read-only vs a write tier), and whether narrowing is
   * active — because a caller whose permitted set exceeds the per-run tool
   * budget is being served a subset chosen by relevance, and a manager
   * wondering why the assistant "did not think of" something deserves to be
   * told that rather than left guessing.
   */
  @Get('capabilities')
  @RequirePermissions('msaidizi.use')
  capabilities(@CurrentUser() user: AuthUser): MsaidiziCapabilities {
    return this.service.capabilitiesFor(user);
  }

  /**
   * One question, answered when the whole run is over.
   *
   * Returns an `AskResult` rather than a bare `RunResult`: the conversation id
   * and turn sequence the store settled on ride back with the answer, because
   * this path has no `session` frame to carry them and this DTO accepts both on
   * the way in.
   *
   * That covers everything a follow-up needs, approvals included. A suspended
   * red-tier action arrives as a `confirmation_required` entry in `events`, and
   * the `grantId` on it is what the next request sends back in `confirmed` — so
   * a non-streaming caller reads its approvals out of the same array a streaming
   * one reads them out of, rather than out of frames it never sees.
   */
  @Post('ask')
  @RequirePermissions('msaidizi.use')
  async ask(
    @Body() dto: AskDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
  ): Promise<AskResult> {
    if (!this.config.enabled) {
      // Deliberately not a 404: the route exists, it is switched off. Saying so
      // is more useful than pretending it was never deployed.
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
    if (!authorization) {
      // Every tool call is made with the caller's own credential. Without one
      // there is nothing to act as, and acting as anything else is the failure
      // this design exists to prevent.
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    const opened = await this.openTurn(dto, user);
    const result = await this.service.run(this.runRequestFor(dto, opened, user, authorization));
    await this.recordQuietly(opened, result);
    // Spread rather than mutated: `close()` was handed `result` itself, and the
    // run result is not this controller's object to rewrite after the fact.
    return { ...result, conversationId: opened.conversationId, sequence: opened.sequence };
  }

  /**
   * Streaming variant of `ask`.
   *
   * A run can involve several model turns and several tool calls, so the wait
   * before a non-streaming response is long enough that the user cannot tell
   * work from a hang. Events are emitted as they happen, ending with a `result`
   * event carrying the run itself.
   *
   * That frame is a bare `RunResult`, not the `AskResult` the non-streaming path
   * returns, and the difference is only in WHEN the same two fields arrive: the
   * conversation id and the sequence go out on the `session` frame before the
   * first model turn, so a run that dies halfway has still reported where it was
   * filed. Putting them on the result frame as well would mean a client had two
   * places to read one answer, and the earlier place is the one that survives.
   */
  @Post('ask/stream')
  @RequirePermissions('msaidizi.use')
  async askStream(
    @Body() dto: AskDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
    if (!authorization) {
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    // Deliberately BEFORE `flushHeaders()`. `open()`'s three refusals — this
    // conversation is not yours (404), it moved on in another window (409), its
    // working state has expired (410) — are answers the client has written copy
    // for, and each one has to arrive as a status code. Once the headers are out
    // the status is 200 forever and the only way left to say any of it is an
    // `error` frame the client can only render as "something went wrong".
    const opened = await this.openTurn(dto, user);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // The audit handle, before the first model turn rather than after the last.
    //
    // A run that drops mid-loop has still opened its row and still stamps every
    // audit entry with this session id, so the one thing the user needs in order
    // to find out what it did is exactly the thing the old ordering withheld
    // until the run finished cleanly. Sent first, it survives the failure.
    //
    // The event name and the payload's `type` say the same word, which is the
    // rule the run-event frames below follow too — they are emitted as
    // `send(event.type, event)`, and they are the only other frames here that
    // carry a `type` at all. The two that do not, `result` and `error`, are
    // keyed off the SSE event name alone and the client decodes them that way.
    // So the contract is not "every frame carries a type"; it is that a frame
    // which carries one must not disagree with its own name, because the client
    // would then hold two contradictory answers to one question.
    //
    // `conversationId` and `sequence` are both absent from the JSON when the
    // turn was not persisted, and that is the contract rather than an artefact
    // of `JSON.stringify`: the client holds its last known-good values through a
    // frame that omits them, and would poison them with a frame that reported
    // zero. See `OpenedTurn.sequence`.
    send('session', {
      type: 'session',
      conversationId: opened.conversationId,
      agentSessionId: opened.sessionId,
      sequence: opened.sequence,
    });

    try {
      const result = await this.service.run(
        this.runRequestFor(dto, opened, user, authorization),
        (event) => send(event.type, event),
      );

      // Recorded BEFORE the result frame, and the ordering is load-bearing. The
      // result frame is what tells the client the run is over, and its next
      // action — a confirmation click on a suspended red-tier action — can
      // arrive within a second and resumes by conversation id. If it read the
      // store before this transaction committed it would resume from the
      // PREVIOUS turn's message array, the model would have no proposal to
      // re-issue, and the run would suspend again: the approval loop this whole
      // design is arranged to prevent.
      //
      // The grant itself is not written here — `run()` records one at the moment
      // it proposes, several hundred milliseconds before this line — so an
      // approval that arrives this fast finds its grant already committed. What
      // this ordering still protects is the conversation the grant is bound to:
      // spending one requires resuming into the same conversation, and a client
      // that read the store a transaction too early would be resuming into the
      // wrong turn of it.
      await this.recordQuietly(opened, result);
      send('result', result);
    } catch {
      // The connection is already open, so an exception filter cannot help —
      // report the failure on the stream rather than hanging the client.
      //
      // The turn's row is deliberately left `reason: 'running'` with no
      // `endedAt`. That is not an omission: it is the trace of a run that
      // started and never reported back, which is precisely the state that was
      // invisible before this table existed. Closing it with a manufactured
      // reason would erase the only evidence that anything went wrong.
      send('error', { message: 'The assistant could not complete this request.' });
    } finally {
      res.end();
    }
  }

  /**
   * The run, as both ask paths ask for it.
   *
   * One builder rather than two object literals, because the two paths must not
   * be able to disagree about what the loop is given — and three of these five
   * fields now decide whether a red-tier action can be approved at all.
   *
   * `sessionId` is the store's, never `dto.sessionId` directly: `open()` resolves
   * the client's id against this caller's own conversations and mints a fresh one
   * when it resolves to nothing of theirs, and the audit rows are stamped with
   * whichever it chose.
   *
   * `conversationId` and `turnSequence` are the grant ledger's coordinates. A
   * grant is issued against the conversation a proposal was made in and
   * spendable only from that same conversation, by that same user, so the loop
   * cannot issue or spend one without being told where it is. Both are absent
   * for an unpersisted turn, and the consequence is deliberate rather than a gap
   * to route around: no conversation means no grant, so a red-tier action in an
   * unpersisted run is not offered for approval at all. Reads and amber writes
   * still work.
   *
   * `opened`, not `dto`, for every one of them. The client sends a conversation
   * id and a sequence too, and they are a CLAIM the store checks — 404 if the
   * conversation is not theirs, 409 if the thread moved on. Binding a grant to
   * the claimed conversation rather than the resolved one would let a caller
   * name someone else's thread as the scope of its own approvals.
   */
  private runRequestFor(
    dto: AskDto,
    opened: OpenedTurn,
    user: AuthUser,
    authorization: string,
  ): RunRequest {
    return {
      user,
      authorization,
      sessionId: opened.sessionId,
      conversationId: opened.conversationId,
      turnSequence: opened.sequence,
      confirmed: dto.confirmed,
      messages: this.messagesFor(dto, opened),
    };
  }

  /**
   * Opens the turn's row before the loop starts.
   *
   * Two kinds of failure meet here and they are not the same thing. A 404, 409
   * or 410 out of `open()` is an ANSWER about this conversation, and it
   * propagates. Anything else is the store being unavailable — which must never
   * be the reason a question goes unanswered, so the run proceeds unpersisted on
   * a session id of its own and only the history is lost.
   *
   * `open()` already degrades internally on every database path it owns; this
   * catch exists so that the run's outcome does not depend on that remaining
   * true in a file this one does not control.
   */
  private async openTurn(dto: AskDto, user: AuthUser): Promise<OpenedTurn> {
    try {
      return await this.conversations.open({
        user,
        prompt: dto.message,
        conversationId: dto.conversationId,
        clientSessionId: dto.sessionId,
        clientSequence: dto.sequence,
        fallbackHistory: (dto.history ?? []) as ModelMessage[],
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Could not open a conversation turn; running unpersisted: ${(err as Error)?.message}`,
      );
      // A FRESH id, never `dto.sessionId`. This is the provenance rule, at the
      // one door that used to route around it: an id the client sent is honoured
      // only where it can be RESOLVED to a conversation this caller owns, and
      // `open()` threw before any row could be read, so there is nothing to
      // resolve it against. Adopting it here would stamp this run's `audit_logs`
      // rows with a well-formed string nothing checked — including, during a read
      // outage, one naming another user's conversation, so that an overseer
      // reading the trail by session id would see two people's work under one
      // key.
      //
      // This used to adopt it, and the reason was real at the time: red-tier
      // confirmation ids were DERIVED from the session id, so minting recomputed
      // every id the user had just approved and left them approving the same
      // action forever. Approvals are server-issued grants now and are not
      // derived from this value, so the cost that made adoption the lesser evil
      // is gone. What an approval loses here it loses anyway — an unpersisted
      // turn has no conversation to bind a grant to, so a red-tier action in this
      // run re-proposes rather than running, which is the fail-closed outcome.
      if (dto.sessionId) {
        this.logger.warn(
          `Session id ${dto.sessionId} could not be checked against this caller's conversations ` +
            `(the turn could not be opened), so it was ignored and a fresh one minted; this run ` +
            `is unpersisted and any red-tier action in it will be proposed again rather than run.`,
        );
      }
      // No `sequence`, for the same reason `degraded()` reports none: this turn
      // has no position in any stored conversation, and a client that stored a
      // `0` from here would send it back and be told its conversation continued
      // in another window for the rest of its life.
      return {
        sessionId: mintSessionId(),
        history: (dto.history ?? []) as ModelMessage[],
        fromServer: false,
        priorTier: 'green',
      };
    }
  }

  /**
   * Records the finished run, and can never fail it.
   *
   * By the time this is reached the model turn has happened and every tool call
   * has already executed against the caller's own data: the answer exists, and
   * whatever the agent changed is already in `audit_logs`. Turning a failed
   * history write into a 500 would tell the user their request failed when it
   * did not, and — under a write mode — would hide the fact that it succeeded.
   * The cost is asymmetric, so this swallows.
   *
   * `close()` documents itself as never throwing and swallows internally. This
   * does not rely on that: the property is load-bearing enough that it is held
   * at both ends rather than by one file's comment.
   */
  private async recordQuietly(opened: OpenedTurn, result: RunResult): Promise<void> {
    try {
      await this.conversations.close(opened, result);
    } catch (err) {
      this.logger.error(
        `Failed to record run ${result.sessionId} on conversation ` +
          `${opened.conversationId ?? '(unpersisted)'}: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * The conversation as the model should receive it.
   *
   * `opened.history` is whichever copy `open()` judged the fresher one — the
   * stored resume state in the ordinary case, the client's own array when the
   * store has none or is a turn behind — so this is the single place the two
   * paths converge. Never `dto.history` directly: choosing between them is the
   * store's decision and this controller must not quietly make a second one.
   */
  private messagesFor(dto: AskDto, opened: OpenedTurn): ModelMessage[] {
    return [...opened.history, { role: 'user', content: dto.message }];
  }
}
