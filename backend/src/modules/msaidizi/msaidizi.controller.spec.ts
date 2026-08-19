/**
 * The ask endpoints and the conversation store.
 *
 * Half of Phase 1 was inert: nothing in `backend/src` called
 * `MsaidiziConversationsService.open()` or `.close()`, so no conversation row
 * was ever written, `GET /msaidizi/conversations` returned `[]` forever, and the
 * entire client-side rail, hydration, delete and resume path was unreachable
 * code shipped against a store that never filled. Nothing in the service's own
 * spec could catch that — the service was correct, it was simply never called.
 * A defect that lives in the seam between two correct files can only be caught
 * at the seam.
 *
 * What is pinned here:
 *
 *   1. Both ask paths open a turn before the loop and record it after.
 *   2. The run uses the session id and the history the STORE settled on. Not
 *      "never the client's copy" — `open()` may well choose the client's array,
 *      and does whenever it holds more of the conversation — but the choice is
 *      the store's, made once, and this controller does not make a second one.
 *   3. Persistence cannot fail a run: the answer already exists and the tool
 *      calls have already happened.
 *   4. The stream emits its `session` frame before the first model turn, so the
 *      audit handle survives a run that dies halfway.
 *   5. `open()`'s three refusals reach the client as status codes, which means
 *      they must be raised before the SSE headers go out.
 *   6. That frame reports a `sequence` only when there is one. It is the client's
 *      claim on its next question, and a zero standing in for "unpersisted" is
 *      the difference between a tab that recovers from a blip and a tab that
 *      answers every later question with "this conversation continued in another
 *      window" until it is reloaded.
 *   7. The run is told WHERE it is. A red-tier approval is a grant bound to a
 *      conversation and a caller, so a loop that is not handed the conversation
 *      the store resolved cannot issue one or spend one — and the failure would
 *      be silent, because a run with no grants looks exactly like a run nobody
 *      approved anything in.
 *   8. A session id the store could not check is IGNORED rather than adopted.
 *      That inverts what this controller used to do, and it could only be
 *      inverted once approvals stopped being derived from the session id.
 */

import { GoneException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziConversationsService, OpenedTurn, mintSessionId } from './conversations.service';
import { mintGrantId } from './dto/approval-grants';
import { AskDto, MsaidiziController } from './msaidizi.controller';
import { MsaidiziConfig } from './msaidizi.config';
import { approvalGrantStoreProvider } from './msaidizi.module';
import {
  APPROVAL_GRANT_STORE,
  MsaidiziEvent,
  MsaidiziService,
  RunRequest,
  RunResult,
} from './msaidizi.service';
import { RunProcedureDto } from './procedures.controller';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AUTH = 'Bearer caller-token';

function authUser(): AuthUser {
  return {
    id: 'user-A',
    email: 'a@itemba.local',
    fullName: 'Asha',
    roles: ['Company Manager'],
    roleScopes: ['COMPANY'],
    permissions: ['msaidizi.use'],
    companyId: 'company-A',
    companyAccess: [],
  } as unknown as AuthUser;
}

function askDto(overrides: Partial<AskDto> = {}): AskDto {
  return { message: 'Which suppliers have unpaid invoices?', ...overrides } as AskDto;
}

function openedTurn(overrides: Partial<OpenedTurn> = {}): OpenedTurn {
  return {
    sessionId: 'ms_fromstore',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    sequence: 1,
    history: [],
    fromServer: false,
    priorTier: 'green',
    ...overrides,
  };
}

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    sessionId: 'ms_fromstore',
    reason: 'end_turn',
    events: [{ type: 'text', text: 'Three of them.' }],
    messages: [{ role: 'user', content: 'Which suppliers have unpaid invoices?' }],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      modelTurns: 1,
    },
    ...overrides,
  };
}

/**
 * A harness that records the ORDER of everything, because most of what this
 * file asserts is ordering: opened before the loop, recorded before the client
 * is told the run is over, headers not yet flushed when `open()` refuses.
 */
function harness(
  options: {
    open?: (input: unknown) => Promise<OpenedTurn>;
    close?: () => Promise<void>;
    run?: (request: RunRequest, emit?: (event: MsaidiziEvent) => void) => Promise<RunResult>;
    enabled?: boolean;
  } = {},
) {
  const trace: string[] = [];

  const opened = openedTurn();
  const result = runResult();

  const conversations = {
    open: jest.fn(async (input: unknown) => {
      trace.push('open');
      return options.open ? options.open(input) : opened;
    }),
    close: jest.fn(async () => {
      trace.push('close');
      if (options.close) await options.close();
    }),
  } as unknown as MsaidiziConversationsService;

  const service = {
    run: jest.fn(async (request: RunRequest, emit?: (event: MsaidiziEvent) => void) => {
      trace.push('run');
      if (options.run) return options.run(request, emit);
      emit?.({ type: 'text', text: 'Three of them.' });
      emit?.({ type: 'done', reason: 'end_turn' });
      return result;
    }),
  } as unknown as MsaidiziService;

  const config = { enabled: options.enabled ?? true } as unknown as MsaidiziConfig;

  const frames: { event: string; data: Record<string, unknown> }[] = [];
  // The bytes, kept alongside the parsed frames. What a client reads is the
  // serialised text, and `JSON.stringify` dropping an undefined field is part of
  // the contract rather than an accident of it — an assertion on a parsed object
  // cannot tell "absent" from "present and undefined", and the client's reducer
  // behaves differently for the two.
  const chunks: string[] = [];
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(() => trace.push('flushHeaders')),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      const [eventLine, dataLine] = chunk.trim().split('\n');
      const event = eventLine.replace('event: ', '');
      frames.push({ event, data: JSON.parse(dataLine.replace('data: ', '')) });
      trace.push(`frame:${event}`);
      return true;
    }),
    end: jest.fn(() => trace.push('end')),
    writableEnded: false,
  } as unknown as Response;

  return {
    controller: new MsaidiziController(service, conversations, config),
    conversations: conversations as unknown as { open: jest.Mock; close: jest.Mock },
    service: service as unknown as { run: jest.Mock },
    res,
    frames,
    chunks,
    trace,
    opened,
    result,
  };
}

// ─── POST /msaidizi/ask ───────────────────────────────────────────────────────

describe('POST /msaidizi/ask persists the conversation', () => {
  it('opens a turn before the loop and records it after', async () => {
    const h = harness();

    await h.controller.ask(askDto(), authUser(), AUTH);

    // The row exists before the model is called: a run that crashes mid-loop
    // has still left something saying it happened.
    expect(h.trace).toEqual(['open', 'run', 'close']);
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Which suppliers have unpaid invoices?',
        user: expect.objectContaining({ id: 'user-A' }),
      }),
    );
    // The run result itself, not the `AskResult` the caller gets back. What is
    // recorded is what the run produced; the conversation id and sequence the
    // answer carries are the store's own and it does not need telling them.
    expect(h.conversations.close).toHaveBeenCalledWith(h.opened, h.result);
  });

  it('runs on the store’s session id, not the client’s copy of it', async () => {
    const h = harness();

    await h.controller.ask(askDto({ sessionId: 'ms_clientheld' }), authUser(), AUTH);

    // `open()` decides: it honours a client's id on the pre-persistence path and
    // mints one otherwise. Whatever it chose is what red-tier confirmation ids
    // are derived from, so the loop has to run under that one and no other.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: 'ms_clientheld' }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_fromstore');
  });

  it('runs on the history open() settled on, not on the copy the client sent', async () => {
    const stored = [
      { role: 'user' as const, content: 'Which suppliers have unpaid invoices?' },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'Three of them.' }] },
    ];
    const h = harness({ open: async () => openedTurn({ history: stored, fromServer: true }) });

    await h.controller.ask(
      askDto({
        message: 'Which is the oldest?',
        conversationId: 'conv-1',
        history: [{ role: 'user', content: 'stale copy from another tab' }] as never,
      }),
      authUser(),
      AUTH,
    );

    // Which of the two copies is the fresher one is decided inside
    // `continueById` and tested there. What is pinned HERE is that the answer
    // reaches the model: the controller reads `opened.history` and never
    // `dto.history`, so it cannot quietly overrule the store.
    expect(h.service.run.mock.calls[0][0].messages).toEqual([
      ...stored,
      { role: 'user', content: 'Which is the oldest?' },
    ]);
  });

  it('still answers when the history write fails', async () => {
    const h = harness({
      close: async () => {
        throw new Error('deadlock detected');
      },
    });

    // The model turn happened and any tool calls already executed. A failed
    // history row must not be presented to the user as a failed request.
    await expect(h.controller.ask(askDto(), authUser(), AUTH)).resolves.toEqual({
      ...h.result,
      conversationId: 'conv-1',
      sequence: 1,
    });
  });

  it('still answers when the store cannot be opened at all, on a session id of its own', async () => {
    const h = harness({
      open: async () => {
        throw new Error('connection refused');
      },
    });

    const result = await h.controller.ask(askDto(), authUser(), AUTH);

    expect(result).toEqual(h.result);
    // Unpersisted, but not unidentified: the run still stamps its audit rows.
    expect(h.service.run.mock.calls[0][0].sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    // And nothing about a conversation, because there is no conversation. Read
    // off the serialised answer rather than the object: `toEqual` above cannot
    // tell an absent key from one present and undefined, and the client's
    // reducer behaves differently for the two.
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('conversationId');
  });

  it('lets open()’s refusals through — they are answers, not outages', async () => {
    const h = harness({
      open: async () => {
        throw new GoneException('This conversation can no longer be continued.');
      },
    });

    await expect(
      h.controller.ask(askDto({ conversationId: 'conv-1' }), authUser(), AUTH),
    ).rejects.toBeInstanceOf(GoneException);
    expect(h.service.run).not.toHaveBeenCalled();
  });

  it('tells the caller which conversation and turn its answer landed in', async () => {
    const h = harness();

    const result = await h.controller.ask(
      askDto({ conversationId: 'conv-1', sequence: 0 }),
      authUser(),
      AUTH,
    );

    // This DTO accepts `conversationId` and `sequence`; without them on the way
    // back out, a non-streaming caller can never learn either, and every path
    // that reads them — `continueById`, the two-tab 409, both 410 sentences — is
    // reachable only from the stream, which has a `session` frame to carry them.
    expect(result.conversationId).toBe('conv-1');
    expect(result.sequence).toBe(1);
    // The run's own fields are untouched by the addition.
    expect(result.sessionId).toBe('ms_fromstore');
    expect(result.reason).toBe('end_turn');
  });

  it('omits both from the answer when the turn was not persisted, rather than sending zero', async () => {
    // What `degraded()` hands back: an id to stamp the audit rows with, and no
    // position in any stored conversation.
    const h = harness({
      open: async () => ({
        sessionId: 'ms_unpersisted',
        history: [],
        fromServer: false,
        priorTier: 'green',
      }),
    });

    const result = await h.controller.ask(
      askDto({ conversationId: 'conv-1', sequence: 5 }),
      authUser(),
      AUTH,
    );

    // Asserted on the bytes, because absent and zero are different answers and
    // only the serialised form distinguishes them. A client holds its last
    // known-good values through an answer that says nothing, and poisons them
    // with one that says zero — see the session frame's own guard below.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('conversationId');
    expect(wire).not.toContain('sequence');
    // Unpersisted, but not unidentified: the run still ran under the id the
    // store settled on, so its audit rows still correlate.
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_unpersisted');
  });

  it('opens nothing when the feature is switched off', async () => {
    const h = harness({ enabled: false });

    await expect(h.controller.ask(askDto(), authUser(), AUTH)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(h.conversations.open).not.toHaveBeenCalled();
  });
});

// ─── POST /msaidizi/ask/stream ────────────────────────────────────────────────

describe('POST /msaidizi/ask/stream persists the conversation and names the run', () => {
  it('emits the session frame before the first model turn', async () => {
    const h = harness();

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // Before `run`, not after: a run whose connection drops mid-loop is exactly
    // when the user needs the handle into the audit trail, and the old ordering
    // withheld it until the run finished cleanly.
    expect(h.trace.indexOf('frame:session')).toBeLessThan(h.trace.indexOf('run'));
    expect(h.frames[0]).toEqual({
      event: 'session',
      data: {
        type: 'session',
        conversationId: 'conv-1',
        agentSessionId: 'ms_fromstore',
        sequence: 1,
      },
    });
  });

  it('never lets a frame’s payload `type` disagree with the frame’s own name', async () => {
    const h = harness();

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // Not "every frame carries a type" — two of the four this method writes do
    // not, and the client decodes those off the SSE event name alone. The rule
    // is the weaker and true one: a frame that carries a `type` must agree with
    // its own name, or the client holds two answers to one question. The
    // carries-none set is asserted rather than skipped, so a `type` quietly
    // added to `result` (which would change what `decodeFrame` sees) shows up
    // here instead of passing through a `continue`.
    const untyped = ['result', 'error'];
    for (const frame of h.frames) {
      if (untyped.includes(frame.event)) {
        expect(frame.data).not.toHaveProperty('type');
        continue;
      }
      expect(frame.data.type).toBe(frame.event);
    }
    expect(h.frames.map((frame) => frame.event)).toContain('result');
  });

  it('records the turn before telling the client the run is over', async () => {
    const h = harness();

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // The result frame is the client's cue to act, and its next action — a
    // confirmation click — resumes by conversation id within a second. Reading
    // the store before this transaction committed would resume from the previous
    // turn's messages and the approved id would match nothing: the approval loop.
    expect(h.trace).toEqual([
      'open',
      'flushHeaders',
      'frame:session',
      'run',
      'frame:text',
      'frame:done',
      'close',
      'frame:result',
      'end',
    ]);
  });

  it('raises open()’s refusals before the headers go out, so they arrive as a status', async () => {
    const h = harness({
      open: async () => {
        throw new GoneException('Its working state has expired.');
      },
    });

    await expect(
      h.controller.askStream(askDto({ conversationId: 'conv-1' }), authUser(), h.res, AUTH),
    ).rejects.toBeInstanceOf(GoneException);

    // Once the headers are flushed the status is 200 forever, and the server's
    // own written sentence could only be delivered as a generic error frame.
    expect(h.res.flushHeaders).not.toHaveBeenCalled();
    expect(h.frames).toEqual([]);
  });

  it('leaves the turn open when the run fails, rather than closing it with a made-up reason', async () => {
    const h = harness({
      run: async () => {
        throw new Error('the model client exploded');
      },
    });

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    expect(h.frames.map((f) => f.event)).toEqual(['session', 'error']);
    // `reason: 'running'` with no `endedAt` IS the trace of a run that started
    // and never reported back. Closing it would erase the only evidence.
    expect(h.conversations.close).not.toHaveBeenCalled();
  });

  it('still streams the answer when the history write fails', async () => {
    const h = harness({
      close: async () => {
        throw new Error('deadlock detected');
      },
    });

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // The result frame still lands, and no `error` frame contradicts it.
    expect(h.frames.map((f) => f.event)).toEqual(['session', 'text', 'done', 'result']);
  });
});

// ─── The session frame's sequence ─────────────────────────────────────────────

describe('the session frame reports a sequence only when there is one', () => {
  it('omits it from the wire when the store degraded the turn, rather than sending zero', async () => {
    // What `degraded()` returns: a session id to stamp the audit rows with, and
    // no position in any stored conversation.
    const h = harness({
      open: async () => ({
        sessionId: 'ms_unpersisted',
        history: [],
        fromServer: false,
        priorTier: 'green',
      }),
    });

    await h.controller.askStream(
      askDto({ conversationId: 'conv-1', sequence: 5 }),
      authUser(),
      h.res,
      AUTH,
    );

    // The client holds its last known-good sequence through a frame that says
    // nothing, and overwrites it with a frame that says zero. `continueById`
    // then reads that zero as a tab behind by every turn, and answers every
    // later question in it with "this conversation continued in another window"
    // — which is untrue, is classified as not worth retrying, and clears only on
    // a full page reload. So the absence is the contract, not a side effect.
    expect(h.chunks[0]).not.toContain('sequence');
    expect(h.chunks[0]).not.toContain('conversationId');
    expect(h.frames[0]).toEqual({
      event: 'session',
      data: { type: 'session', agentSessionId: 'ms_unpersisted' },
    });
  });

  it('omits it when open() itself threw and the run proceeded unpersisted', async () => {
    const h = harness({
      open: async () => {
        throw new Error('connection refused');
      },
    });

    await h.controller.askStream(
      askDto({ conversationId: 'conv-1', sequence: 5 }),
      authUser(),
      h.res,
      AUTH,
    );

    // The controller's own fallback holds the same line as the service's: this
    // turn has no position to report, so it reports none.
    expect(h.chunks[0]).not.toContain('sequence');
    expect(h.frames[0].data).toEqual({
      type: 'session',
      agentSessionId: expect.stringMatching(/^ms_[0-9a-f]{32}$/),
    });
  });

  it('still reports it, on the wire, for a turn that was persisted', async () => {
    const h = harness();

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // The other half of the contract: the guard above must not be paid for by a
    // client that can no longer detect a second window at all.
    expect(h.chunks[0]).toContain('"sequence":1');
    expect(h.chunks[0]).toContain('"conversationId":"conv-1"');
  });
});

// ─── The session id a client may send ─────────────────────────────────────────

/**
 * A session id is an AUDIT KEY, not an opaque string, and both DTOs that take
 * one now say so.
 *
 * Whatever a client sends is what `open()` settles on when it resolves to
 * nothing of that caller's, what the agent runs under, and what
 * `capability-invoker` sends as the agent-session header that every `audit_logs`
 * row the run writes is stamped with. Unconstrained, that lets a caller file its
 * own actions under a session id it read somewhere else: not a permission
 * escalation — the run still executes under the caller's own token — but an
 * overseer reading the trail by session id sees one user's actions under another
 * user's run.
 *
 * What the pattern buys, exactly, and no more. It is the alphabet and length
 * `mintSessionId()` produces, so the only values accepted are ones that COULD
 * have been minted here — which keeps hand-written and copied strings out of an
 * audit column. It is not a provenance check and cannot be one: a client with a
 * random-hex generator produces conforming ids all day, and the third test below
 * exists to keep that written down rather than rediscovered. The echo has to be
 * accepted from the request body regardless, because red-tier confirmation ids
 * are derived from the session id.
 *
 * The property the audit trail needs — that a run is never filed under a session
 * id belonging to somebody else — is enforced a layer down, by the unique index
 * on `MsaidiziConversation.agentSessionId`. `conversations.service.spec.ts` holds
 * it, under "a session id that already names a conversation is never adopted".
 *
 * Driven through the decorators rather than through the controller, because what
 * is being tested is what the DTO permits and the global ValidationPipe is what
 * enforces it. The controller specs above construct DTOs directly and would go
 * on passing whatever this rejects.
 */
describe('the session id a client may send is pinned to the shape this server mints', () => {
  async function reasons(dto: object, cls: new () => object) {
    const errors = await validate(plainToInstance(cls, dto));
    return errors.map((error) => error.property);
  }

  it('accepts what mintSessionId() actually produces', async () => {
    const minted = mintSessionId();

    expect(await reasons({ message: 'Hello', sessionId: minted }, AskDto)).toEqual([]);
    expect(await reasons({ sessionId: minted }, RunProcedureDto)).toEqual([]);
  });

  it('rejects a hand-written or copied one, on both surfaces', async () => {
    // The shape a hand-written or copied id has. Long enough for the old
    // `@MaxLength(128)`, which is why that constraint never caught anything.
    const foreign = 'ms_someone-elses-run';

    expect(await reasons({ message: 'Hello', sessionId: foreign }, AskDto)).toEqual(['sessionId']);
    expect(await reasons({ sessionId: foreign }, RunProcedureDto)).toEqual(['sessionId']);
  });

  it('accepts a conforming one a client generated, because shape is all this is', async () => {
    // Built the way a client would, without `mintSessionId()` anywhere near it.
    // This is not a defect being tolerated, it is the boundary of what a regex
    // on a string can decide — recorded here so no comment upstream can quietly
    // promote "could have been minted" back into "was minted". Running under an
    // id of one's own invention is harmless; running under someone ELSE'S is
    // what matters, and that is refused by the unique index, not by this.
    const generated = `ms_${'0123456789abcdef'.repeat(2)}`;

    expect(generated).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(await reasons({ message: 'Hello', sessionId: generated }, AskDto)).toEqual([]);
    expect(await reasons({ sessionId: generated }, RunProcedureDto)).toEqual([]);
  });

  it('still lets a caller send none at all, which is how a run starts', async () => {
    expect(await reasons({ message: 'Hello' }, AskDto)).toEqual([]);
    expect(await reasons({ context: 'for March' }, RunProcedureDto)).toEqual([]);
  });
});

// ─── Where the run is, so an approval can be bound to it ──────────────────────

/**
 * A red-tier approval is a GRANT: a nonce the server writes when it proposes and
 * spends when it dispatches, bound in the ledger to a conversation, a caller, a
 * tool and a digest of the exact arguments. The loop cannot write one or find one
 * without being told which conversation it is running in — and being told wrong
 * is worse than not being told, because a grant scoped to a conversation the
 * CALLER named rather than the one the STORE resolved would let a request bind
 * its own approvals to somebody else's thread.
 *
 * So this is the seam: `open()` decides where the turn landed, and the controller
 * must carry that decision — and only that decision — into `run()`. Nothing
 * downstream can detect the omission. A run that was never given a conversation
 * simply issues no grants, and a run that issues no grants looks precisely like
 * one the user did not approve anything in.
 */
describe('the ask paths tell the run which conversation and turn it is in', () => {
  it('passes the conversation and sequence the store resolved', async () => {
    const h = harness();

    await h.controller.ask(askDto(), authUser(), AUTH);

    expect(h.service.run.mock.calls[0][0]).toEqual(
      expect.objectContaining({ conversationId: 'conv-1', turnSequence: 1 }),
    );
  });

  it('passes them on the streaming path too, not only the buffered one', async () => {
    const h = harness();

    await h.controller.askStream(askDto(), authUser(), h.res, AUTH);

    // Two call sites, one builder. The streaming path is the one a real client
    // uses, and it was the path that used to be assembled separately.
    expect(h.service.run.mock.calls[0][0]).toEqual(
      expect.objectContaining({ conversationId: 'conv-1', turnSequence: 1 }),
    );
  });

  it('uses the conversation open() resolved, never the one the request claimed', async () => {
    // The store answered with a different conversation than the client named —
    // which is what `continueBySession` does when a session id resolves to
    // nothing of this caller's and a fresh conversation is started instead.
    const h = harness({ open: async () => openedTurn({ conversationId: 'conv-resolved' }) });

    await h.controller.ask(
      askDto({ conversationId: 'conv-claimed', confirmed: [mintGrantId()] }),
      authUser(),
      AUTH,
    );

    // A grant is spendable only from the conversation it was issued in, so this
    // value IS the scope of every approval in the run. Taking it from the body
    // would make that scope caller-chosen, which is the property the ledger
    // exists to hold.
    expect(h.service.run.mock.calls[0][0].conversationId).toBe('conv-resolved');
  });

  it('reports no conversation and no turn when the turn was not persisted', async () => {
    const h = harness({
      open: async () => ({
        sessionId: 'ms_unpersisted',
        history: [],
        fromServer: false,
        priorTier: 'green',
      }),
    });

    await h.controller.ask(askDto({ conversationId: 'conv-1', sequence: 5 }), authUser(), AUTH);

    // Absent rather than invented. There is no conversation to bind a grant to,
    // and the loop has to be able to see that: a red-tier action in this run is
    // not offered for approval at all, which is the fail-closed answer. Passing
    // the client's `conversationId` through here to "keep approvals working"
    // would be offering an approval scoped to a conversation nothing verified.
    const request = h.service.run.mock.calls[0][0];
    expect(request.conversationId).toBeUndefined();
    expect(request.turnSequence).toBeUndefined();
  });
});

// ─── A session id the store could not check ───────────────────────────────────

describe('a session id that could not be resolved is ignored, not adopted', () => {
  const CLIENT_HELD = `ms_${'a'.repeat(32)}`;

  it('mints a fresh one when open() could not be reached', async () => {
    const h = harness({
      open: async () => {
        throw new Error('connection refused');
      },
    });

    await h.controller.ask(askDto({ sessionId: CLIENT_HELD }), authUser(), AUTH);

    // The provenance rule, at the one door that used to route around it: an id
    // from the request is honoured only where it can be RESOLVED to a
    // conversation this caller owns, and `open()` threw before any row could be
    // read. Adopting it stamps this run's `audit_logs` rows with a well-formed
    // string nothing checked — including, during a read outage, one naming
    // another user's conversation, so that a trail read by session id shows two
    // people's work under one key.
    const sessionId = h.service.run.mock.calls[0][0].sessionId;
    expect(sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(sessionId).not.toBe(CLIENT_HELD);
  });

  it('costs an approval nothing it was not already going to lose', async () => {
    const h = harness({
      open: async () => {
        throw new Error('connection refused');
      },
    });

    await h.controller.ask(
      askDto({ sessionId: CLIENT_HELD, confirmed: [mintGrantId()] }),
      authUser(),
      AUTH,
    );

    // This is why the inversion is affordable now and was not before. Approvals
    // used to be DERIVED from the session id, so minting one recomputed every id
    // the user had just approved and left them approving the same action for
    // ever. A grant is a nonce bound to a conversation row, and this turn has no
    // conversation row — so the approval was unspendable the moment `open()`
    // failed, whatever id the run adopted. Nothing was traded away.
    const request = h.service.run.mock.calls[0][0];
    expect(request.conversationId).toBeUndefined();
    expect(request.confirmed).toHaveLength(1);
  });

  it('still runs on a resolved id when the store answers', async () => {
    const h = harness();

    await h.controller.ask(askDto({ sessionId: CLIENT_HELD }), authUser(), AUTH);

    // The other half: ignoring an id is the DEGRADED path, not the normal one.
    // `open()` resolving the client's id to one of its conversations is how a
    // multi-turn thread keeps one audit key, and this must not have become a
    // fresh id per turn.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: CLIENT_HELD }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_fromstore');
  });
});

// ─── The follow-up a non-streaming caller has to be able to build ─────────────

describe('POST /msaidizi/ask hands back everything its own DTO accepts', () => {
  /**
   * A session id of the shape this server actually mints.
   *
   * The shared fixture uses `ms_fromstore`, which is fine everywhere it is only
   * compared for identity and wrong here: this describe feeds the answer back
   * through the request DTO, and a fixture the pipe would reject cannot tell
   * whether the round trip closes. A fixture that structurally excludes the
   * failing case is how three earlier defects in this feature survived review.
   */
  const STORE_SESSION = mintSessionId();

  function proposing(grantId: string) {
    return harness({
      open: async () => openedTurn({ sessionId: STORE_SESSION }),
      run: async () =>
        runResult({
          sessionId: STORE_SESSION,
          reason: 'awaiting_confirmation',
          events: [
            {
              type: 'confirmation_required',
              grantId,
              confirmationId: 'a'.repeat(64),
              tool: 'Journals_create',
              capabilityId: 'journals.create',
              description: 'Post a journal entry',
              args: { amount: 9_000_000 },
            },
          ] as unknown as MsaidiziEvent[],
        }),
    });
  }

  it('gives a buffered caller the grant id, the conversation and the sequence', async () => {
    const grantId = mintGrantId();
    const h = proposing(grantId);

    const answer = await h.controller.ask(askDto(), authUser(), AUTH);

    // The whole of the follow-up, off one response. There is no `session` frame
    // on this path, so anything the client cannot read here it cannot read at
    // all — and this DTO accepts every one of these fields on the way in.
    const proposal = answer.events.find((event) => event.type === 'confirmation_required');
    expect(proposal).toBeDefined();
    expect((proposal as unknown as { grantId: string }).grantId).toBe(grantId);
    expect(answer.conversationId).toBe('conv-1');
    expect(answer.sequence).toBe(1);
    expect(answer.sessionId).toBe(STORE_SESSION);
  });

  it('builds a follow-up the production pipe accepts', async () => {
    const grantId = mintGrantId();
    const h = proposing(grantId);

    const answer = await h.controller.ask(askDto(), authUser(), AUTH);
    const proposal = answer.events.find(
      (event) => event.type === 'confirmation_required',
    ) as unknown as { grantId: string };

    // Assembled the way a client would, from the answer alone. Validated rather
    // than assumed, because the field it fills is the one that stopped accepting
    // arbitrary strings: an answer whose grant ids the request DTO rejects would
    // be a contract that cannot be completed.
    const followUp = plainToInstance(AskDto, {
      message: 'yes, post it',
      sessionId: answer.sessionId,
      conversationId: answer.conversationId,
      sequence: answer.sequence,
      confirmed: [proposal.grantId],
    });

    expect(await validate(followUp)).toEqual([]);
  });

  it('carries the approval into the run it answers, with the scope to spend it', async () => {
    const grantId = mintGrantId();
    const h = harness();

    await h.controller.ask(askDto({ message: 'yes', confirmed: [grantId] }), authUser(), AUTH);

    const request = h.service.run.mock.calls[0][0];
    expect(request.confirmed).toEqual([grantId]);
    // Useless without the scope: the ledger spends a grant against a
    // conversation and a caller, so the id alone proves nothing.
    expect(request.conversationId).toBe('conv-1');
  });
});

// ─── The wiring the ledger depends on ─────────────────────────────────────────

/**
 * `APPROVAL_GRANT_STORE` must resolve to the SAME OBJECT the controllers hold.
 *
 * A `useClass` binding would compile, boot, pass every other test in this
 * repository, and be wrong in a way nothing downstream can see: grants written
 * into one instance, spent from another, every approval refused, every red-tier
 * action re-proposed for ever, and no error anywhere. From the seat it is
 * indistinguishable from the server ignoring the button.
 *
 * Nest does not type-check a token binding against the interface the injecting
 * class declared, so this is also the only place the aliasing is checked at all.
 */
describe('the approval ledger the loop injects is the store the controllers use', () => {
  it('resolves the token to the same instance, not a second one', async () => {
    const store = { open: jest.fn(), close: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: MsaidiziConversationsService, useValue: store },
        approvalGrantStoreProvider,
      ],
    }).compile();

    expect(moduleRef.get(APPROVAL_GRANT_STORE)).toBe(moduleRef.get(MsaidiziConversationsService));
    expect(moduleRef.get(APPROVAL_GRANT_STORE)).toBe(store);
  });
});
