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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConversationsService, mintSessionId, OpenedTurn } from './conversations.service';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziCapabilities, MsaidiziService, RunResult } from './msaidizi.service';
import { ModelMessage } from './model-client';

/**
 * One prior turn, echoed back from the previous response's `messages`.
 *
 * This has to be a class with real decorators, not the `ModelMessage` interface.
 * The global ValidationPipe runs `whitelist: true`, which strips any property it
 * cannot see a decorator for — and an interface carries no metadata at runtime,
 * so an undecorated `history` arrives as an array of empty objects and the model
 * request fails with "messages.0: Input does not match the expected shape".
 *
 * `content` is deliberately only `@IsDefined()`. It is a string on user turns and
 * an array of provider content blocks on assistant turns, and those blocks must
 * survive the round trip byte-for-byte. Declaring a nested type here would make
 * the pipe recurse and strip fields inside them — including the ones the API
 * requires echoed back unchanged.
 */
export class ConversationMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsDefined()
  content!: unknown;
}

/**
 * The shape `mintSessionId()` mints: `ms_` and a UUID with its dashes removed.
 * `procedures.controller.ts` pins its own session id field to a copy of this.
 */
const SESSION_ID = /^ms_[0-9a-f]{32}$/;

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  /** Conversation state returned by the previous turn, echoed back verbatim. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  history?: ConversationMessageDto[];

  /**
   * The session id of the run being continued, echoed back from the previous
   * turn's `AskResult` or `session` frame.
   *
   * An AUDIT key rather than an opaque string, which is why it is constrained at
   * all: `open()` settles on whatever arrives here when it resolves to nothing
   * of this caller's, the run then executes under it, and `capability-invoker`
   * sends it as the agent-session header every `audit_logs` row the run writes
   * is stamped with.
   *
   * The pattern checks SHAPE, and stating that plainly is the point. It is the
   * alphabet and length `mintSessionId()` produces, so a hand-written or copied
   * string is rejected — but any client with a random-hex generator satisfies
   * it, and no validator on this field can tell an id this server issued from
   * one a caller invented that looks the same.
   *
   * The threat the shape check cannot reach — a caller filing its own actions
   * under a session id it read SOMEWHERE ELSE, so that an overseer reading the
   * trail by session id sees them under another user's run — is closed a layer
   * down, by the unique index on the column: an id that already names a
   * conversation is rejected on insert and the run is given a freshly minted one
   * instead. See `conversations.service.ts`, `startConversation`.
   */
  @IsOptional()
  @IsString()
  @Matches(SESSION_ID)
  sessionId?: string;

  /** Confirmation ids the user has explicitly approved for this turn. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  confirmed?: string[];

  /**
   * Continue a stored conversation, by id.
   *
   * Sending this moves the client onto the stored-state path, which is what lets
   * a conversation be picked up from a second tab or a different device rather
   * than only from the tab that started it. Author-only — someone else's id is a
   * 404, not a 403, because there is nothing to tell a non-author about a
   * conversation that is not theirs, including that it exists.
   *
   * It does NOT replace `history`, and sending both is the normal case. The
   * server keeps the copy that holds more of the conversation, so the stored
   * state wins the case this field exists for (a tab that has none, or one a
   * turn behind) while a client that is holding a turn the store failed to
   * record keeps it. `continueById` states the rule.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  /**
   * The turn sequence this client last saw, sent alongside `conversationId`.
   *
   * When the conversation has moved on in another window the request is a 409
   * rather than a silent divergence between two tabs writing alternate futures
   * into one thread.
   *
   * Sequences are 1-based, so only a positive value is a claim about stored
   * state; `open()` ignores anything else rather than reading it as a tab that
   * has fallen behind by every turn. `@Min(0)` rather than `@Min(1)` because a
   * client already in the field can still send the `0` this server used to
   * report for an unpersisted turn, and answering that with a 400 would be a
   * harder failure than the one being removed.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;
}

/**
 * What `POST /msaidizi/ask` answers with: the run, plus where it landed.
 *
 * The two extra fields are the non-streaming half of the `session` frame. This
 * DTO accepts `conversationId` and `sequence`, and a caller that is never told
 * which conversation the server filed its turn under, or which turn number it
 * got, can never send either of them back — which leaves `continueById`, the
 * two-tab 409 and both 410 sentences reachable only from the stream. Accepting
 * input a caller has no way to follow up is the asymmetry this closes.
 *
 * Both are optional, and ABSENT rather than zero when the turn was not
 * persisted, exactly as the `session` frame is: `JSON.stringify` drops an
 * undefined field, so a client holds its last known-good values through an
 * answer that omits them. See `OpenedTurn.sequence` for why a zero would be
 * worse than silence.
 */
export interface AskResult extends RunResult {
  conversationId?: string;
  sequence?: number;
}

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
    const result = await this.service.run({
      user,
      authorization,
      // The session id the store settled on, never `dto.sessionId` directly.
      // `open()` honours a client's own id and mints one otherwise, and red-tier
      // confirmation ids are derived from whichever it chose — a second id in
      // play here is the infinite approval loop.
      sessionId: opened.sessionId,
      confirmed: dto.confirmed,
      messages: this.messagesFor(dto, opened),
    });
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
        {
          user,
          authorization,
          sessionId: opened.sessionId,
          confirmed: dto.confirmed,
          messages: this.messagesFor(dto, opened),
        },
        (event) => send(event.type, event),
      );

      // Recorded BEFORE the result frame, and the ordering is load-bearing. The
      // result frame is what tells the client the run is over, and its next
      // action — a confirmation click on a suspended red-tier action — can
      // arrive within a second and resumes by conversation id. If it read the
      // store before this transaction committed it would resume from the
      // PREVIOUS turn's message array, the approved confirmation id would not
      // match anything in it, and the run would suspend again: the approval loop
      // this whole design is arranged to prevent.
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
      // The caller's own session id is adopted here with nothing having checked
      // it — the same residual `conversations.service.ts` routes through
      // `unverifiedSessionId()`, reached by a second door. `open()` threw before
      // any row could be read, so there is no `agentSessionId` to compare
      // against, and minting a fresh one instead would recompute every red-tier
      // confirmation id (they are derived from the session id) and leave the
      // user approving the same action forever without it running. So the id is
      // taken, and the fact that it was never verified is stated rather than
      // left silent: this run's `audit_logs` rows carry a well-formed id that
      // arrived in the request body.
      if (dto.sessionId) {
        this.logger.warn(
          `Session id ${dto.sessionId} could not be checked against this caller's conversations ` +
            `(the turn could not be opened); this run is unpersisted and its audit rows will ` +
            `carry an id supplied by the request rather than one this server resolved or minted.`,
        );
      }
      // No `sequence`, for the same reason `degraded()` reports none: this turn
      // has no position in any stored conversation, and a client that stored a
      // `0` from here would send it back and be told its conversation continued
      // in another window for the rest of its life.
      return {
        sessionId: dto.sessionId ?? mintSessionId(),
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
