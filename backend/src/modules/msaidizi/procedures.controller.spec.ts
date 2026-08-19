/**
 * A procedure run leaves a record.
 *
 * `POST /msaidizi/procedures/:id/run` called `MsaidiziService.run()` directly,
 * so it wrote no conversation row and no turn: `OpenTurnInput.procedureId` and
 * the `procedureId` column on `msaidizi_conversation_turns` existed for exactly
 * this case and were never populated by anything. That is the worst case to
 * leave unattributed, because a procedure is the one agent action a human
 * pre-approved — "which saved instruction did this, and under whose name" is the
 * question a reviewer arrives with, and the answer was nowhere.
 *
 * The ask path's own spec pins the same seam for `/ask`; this pins it here,
 * because a defect that lives between two correct files is only visible at the
 * seam and neither file's own spec can see it.
 *
 * The second thing pinned here is the session id an approval travels on. Wiring
 * the store in without it made every red-tier procedure structurally
 * unapprovable — a fresh conversation per attempt, so an approval never returned
 * to the thread it answered — while the file's own comment claimed the
 * protection it had just lost.
 *
 * The third is the approval round trip itself, across two separate HTTP
 * requests. A procedure goes through the same red-tier gate as an ask and there
 * is no second approval path, so what has to be proved at this seam is that the
 * two requests carry between them what the gate needs: the grant id out, the
 * grant id and the session id back, and the conversation the STORE resolved as
 * the scope both are judged against.
 */

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziConversationsService, OpenedTurn, mintSessionId } from './conversations.service';
import { mintGrantId } from './dto/approval-grants';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziEvent, MsaidiziService, RunRequest, RunResult } from './msaidizi.service';
import { ProceduresController, RunProcedureDto } from './procedures.controller';
import { ProceduresService } from './procedures.service';

const AUTH = 'Bearer caller-token';
/** The id the stand-in store mints when a request carries none. */
const MINTED = mintSessionId();

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
    events: [{ type: 'text', text: 'Done.' }],
    messages: [{ role: 'user', content: 'Reconcile the supplier ledger.' }],
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

function harness(
  options: {
    open?: (input: unknown) => Promise<OpenedTurn>;
    close?: () => Promise<void>;
    run?: (request: RunRequest) => Promise<RunResult>;
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
    run: jest.fn(async (request: RunRequest, _emit?: (event: MsaidiziEvent) => void) => {
      trace.push('run');
      return options.run ? options.run(request) : result;
    }),
  } as unknown as MsaidiziService;

  const procedures = {
    resolveForRun: jest.fn(async () => ({
      instruction: 'Reconcile the supplier ledger.',
      entries: [{ name: 'SupplierInvoices_findAll' }],
    })),
  } as unknown as ProceduresService;

  const config = { enabled: true } as unknown as MsaidiziConfig;

  return {
    controller: new ProceduresController(procedures, service, conversations, config),
    conversations: conversations as unknown as { open: jest.Mock; close: jest.Mock },
    service: service as unknown as { run: jest.Mock },
    trace,
    opened,
    result,
  };
}

describe('POST /msaidizi/procedures/:id/run records the run', () => {
  it('opens a turn before the loop, attributes it to the procedure, and closes it after', async () => {
    const h = harness();

    await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // The row exists before the model is called, so a run that dies mid-loop has
    // still left the session id that finds whatever it managed to change.
    expect(h.trace).toEqual(['open', 'run', 'close']);
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({
        procedureId: 'proc-7',
        prompt: 'Reconcile the supplier ledger.',
        user: expect.objectContaining({ id: 'user-A' }),
      }),
    );
    // The run result itself, not the `ProcedureRunResult` the caller gets back.
    // What is recorded is what the run produced; the conversation id and
    // sequence the answer carries are the store's own and it does not need
    // telling them.
    expect(h.conversations.close).toHaveBeenCalledWith(h.opened, h.result);
  });

  it('runs on the session id the store settled on', async () => {
    const h = harness();

    await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // Red-tier confirmation ids are derived from the session id. A second id in
    // play here is the infinite approval loop.
    expect(h.service.run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ms_fromstore' }),
    );
  });

  it('folds the run context into the prompt that is stored', async () => {
    const h = harness();

    await h.controller.run('proc-7', { context: 'for March' } as RunProcedureDto, authUser(), AUTH);

    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('for March') }),
    );
  });

  it('does not fail the run when the history write fails', async () => {
    const h = harness({
      close: async () => {
        throw new Error('database gone');
      },
    });

    // Every tool call has already executed against the caller's own data by the
    // time close() runs. A 500 here would report a failure that did not happen,
    // and under a write mode would hide a change that did. The turn's row was
    // opened, so the answer still names the conversation it belongs to — only
    // the record of how it ended was lost.
    await expect(
      h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH),
    ).resolves.toEqual({ ...h.result, conversationId: 'conv-1', sequence: 1 });
  });

  it('still runs, unpersisted, when the store cannot open a turn', async () => {
    const h = harness({
      open: async () => {
        throw new Error('database gone');
      },
    });

    const result = await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    expect(result).toEqual(h.result);
    // A minted id rather than none: the audit rows still correlate to each other
    // even though no conversation row exists to find them from.
    expect(h.service.run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.stringMatching(/^ms_/) }),
    );
    // Nothing to close, and close() is a no-op on a turn with no id anyway.
    expect(h.trace).toEqual(['open', 'run', 'close']);
  });
});

// ─── Approving a red-tier step inside a procedure ─────────────────────────────

describe('an approval resubmitted to a procedure run returns to the conversation it was issued in', () => {
  const SUSPENDED = mintSessionId();

  /**
   * A store that honours a client's session id and files each one under its own
   * conversation, as the real one does when the id resolves to a conversation
   * this caller owns.
   */
  function honouring() {
    return harness({
      open: async (input) => {
        const sessionId = (input as { clientSessionId?: string }).clientSessionId ?? MINTED;
        return openedTurn({ sessionId, conversationId: `conv-for-${sessionId}` });
      },
    });
  }

  it('runs under the id the client echoed back, not one minted for the attempt', async () => {
    const h = honouring();
    const grantId = mintGrantId();

    await h.controller.run(
      'proc-7',
      { sessionId: SUSPENDED, confirmed: [grantId] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // The id is how the approval gets back into the conversation the proposal
    // was made in: a grant is spendable only from the conversation it was issued
    // in, so a run that starts a new one finds nothing matching what the user
    // approved and proposes the action again. This controller passed nothing at
    // all, which made that loop unbreakable from the API.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: SUSPENDED }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe(SUSPENDED);
    expect(h.service.run.mock.calls[0][0].confirmed).toEqual([grantId]);
  });

  it('tells the run which conversation and turn the approval is scoped to', async () => {
    const h = honouring();

    await h.controller.run(
      'proc-7',
      { sessionId: SUSPENDED, confirmed: [mintGrantId()] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // A procedure run goes through the same gate as an ask, and the gate cannot
    // spend a grant it cannot scope. Without these two the id above authorises
    // nothing, and the failure is silent: the step is proposed again and looks
    // exactly like a step nobody approved.
    expect(h.service.run.mock.calls[0][0]).toEqual(
      expect.objectContaining({ conversationId: `conv-for-${SUSPENDED}`, turnSequence: 1 }),
    );
  });

  it('mints a fresh id when the store cannot open a turn for the attempt', async () => {
    const h = harness({
      open: async () => {
        throw new Error('database gone');
      },
    });

    await h.controller.run(
      'proc-7',
      { sessionId: SUSPENDED, confirmed: [mintGrantId()] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // This test used to assert the opposite, and the old assertion was right for
    // the old design: red-tier ids were DERIVED from the session id, so adopting
    // the client's was the only way an approval could survive a store outage.
    //
    // With a ledger it is the wrong trade. The id cannot be RESOLVED to any
    // conversation of this caller's — `open()` threw before a row could be read
    // — so adopting it stamps the audit trail with a string nothing checked,
    // while buying the approval nothing: an unpersisted run has no conversation
    // to spend a grant from, so the step re-proposes either way. Fail closed,
    // and do not borrow an audit key on the way.
    const request = h.service.run.mock.calls[0][0];
    expect(request.sessionId).toMatch(/^ms_[0-9a-f]{32}$/);
    expect(request.sessionId).not.toBe(SUSPENDED);
    expect(request.conversationId).toBeUndefined();
  });

  it('starts a fresh conversation for a plain invocation, which carries no id', async () => {
    const h = honouring();

    await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // The other half: a procedure invoked normally is a new run, and must not
    // be filed into whatever conversation ran it last.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: undefined }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe(MINTED);
  });

  it('sends the model the working state the store handed back, not the instruction alone', async () => {
    const suspended = [
      { role: 'user' as const, content: 'Reconcile the supplier ledger.' },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'tu_1' }] },
    ];
    const h = harness({ open: async () => openedTurn({ history: suspended, fromServer: true }) });

    await h.controller.run(
      'proc-7',
      { sessionId: SUSPENDED, confirmed: [mintGrantId()] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // Re-deriving the action from the instruction alone would work only as long
    // as the model made the identical choice twice; resuming from what it
    // already proposed is what lets the run re-issue the action the grant was
    // written for.
    expect(h.service.run.mock.calls[0][0].messages).toEqual([
      ...suspended,
      { role: 'user', content: 'Reconcile the supplier ledger.' },
    ]);
  });
});

// ─── What the run answers with ────────────────────────────────────────────────

describe('a procedure run says where it landed', () => {
  it('reports the conversation and the turn sequence', async () => {
    const h = harness();

    const result = await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // This endpoint accepts `sessionId` and `confirmed`, so it is a resumable
    // surface — and a caller never told where its run was filed cannot tell an
    // approvable proposal from one no grant could be issued for. The ask path
    // has carried these two for a while; this one returned a bare `RunResult`.
    expect(result.conversationId).toBe('conv-1');
    expect(result.sequence).toBe(1);
    // The run's own fields are untouched by the addition.
    expect(result.sessionId).toBe('ms_fromstore');
    expect(result.reason).toBe('end_turn');
  });

  it('omits both from the wire when the turn was not persisted, rather than sending zero', async () => {
    const h = harness({
      open: async () => ({
        sessionId: 'ms_unpersisted',
        history: [],
        fromServer: false,
        priorTier: 'green',
      }),
    });

    const result = await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // Asserted on the bytes: absent and zero are different answers and only the
    // serialised form distinguishes them. Absent also means "no grant could have
    // been issued here", which is exactly what a client needs in order to stop
    // offering an approval button that can never work.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('conversationId');
    expect(wire).not.toContain('sequence');
  });
});

// ─── The approval round trip, across separate requests ────────────────────────

/**
 * The durable half of the fix, exercised at the seam this file owns.
 *
 * The gate itself lives in `msaidizi.service.ts` and is tested there. What is
 * pinned HERE is that the two HTTP requests an approval takes actually carry
 * what the gate needs between them: the grant id out on the first response, the
 * grant id and a session id back on the second, and — the part this controller
 * had no way to supply before — the CONVERSATION the store resolved, which is
 * the scope the grant was written under.
 *
 * The stand-in ledger below holds the three properties the real one holds: a
 * spend is one-shot, it is scoped to a conversation and a caller, and a refused
 * spend is followed by a NEW grant rather than a reused one. It is a stand-in
 * for the gate, not a copy of it.
 *
 * The shapes deliberately covered, because each is one an earlier round of this
 * work had no test for:
 *
 *   - the SAME action approved once and replayed on a LATER REQUEST, which is
 *     the case an in-request `Set` could never see;
 *   - the same action legitimately proposed again afterwards, which is the case
 *     that rules out remembering ids for ever;
 *   - a grant crossing a conversation boundary.
 */
describe('approving a red-tier step of a procedure, over two requests', () => {
  const ACTION = { tool: 'Journals_create', digest: 'digest-of-the-payroll-journal' };

  /** One row of the stand-in ledger. */
  interface Row {
    conversationId: string;
    userId: string;
    toolName: string;
    digest: string;
    usedAt: Date | null;
  }

  function ledger() {
    const rows = new Map<string, Row>();
    return {
      rows,
      issue(conversationId: string, userId: string): string {
        const grantId = mintGrantId();
        rows.set(grantId, {
          conversationId,
          userId,
          toolName: ACTION.tool,
          digest: ACTION.digest,
          usedAt: null,
        });
        return grantId;
      },
      /** One-shot and scoped. Returns whether THIS call won a grant. */
      spend(offered: string[], conversationId: string, userId: string): boolean {
        for (const grantId of offered) {
          const row = rows.get(grantId);
          if (!row || row.usedAt) continue;
          if (row.conversationId !== conversationId || row.userId !== userId) continue;
          if (row.toolName !== ACTION.tool || row.digest !== ACTION.digest) continue;
          row.usedAt = new Date();
          return true;
        }
        return false;
      },
    };
  }

  /** A procedure server: honours session ids, and runs the gate above. */
  function server() {
    const book = ledger();
    const dispatches: string[] = [];
    const h = harness({
      open: async (input) => {
        const sessionId =
          (input as { clientSessionId?: string }).clientSessionId ?? mintSessionId();
        return openedTurn({ sessionId, conversationId: `conv-for-${sessionId}` });
      },
      run: async (request) => {
        const conversationId = request.conversationId;
        // The run reports the id it RAN UNDER, which is the store's, not the
        // fixture's constant. The client's next request is built from this
        // value, so a fixture that answered with a different one would have the
        // approval arrive in a conversation the grant was never written in —
        // and the round trip would fail for a reason that is not the code's.
        const sessionId = request.sessionId ?? 'ms_unknown';
        if (!conversationId) {
          // No conversation, no ledger scope: nothing to issue and nothing to
          // spend. Fail closed rather than dispatching.
          return runResult({
            sessionId,
            reason: 'failed',
            events: [{ type: 'error', message: 'no scope' }],
          });
        }
        if (book.spend(request.confirmed ?? [], conversationId, request.user.id)) {
          dispatches.push(conversationId);
          return runResult({
            sessionId,
            reason: 'end_turn',
            events: [
              {
                type: 'tool_call',
                tool: ACTION.tool,
                capabilityId: 'journals.create',
                tier: 'red',
                args: {},
              },
            ],
          });
        }
        const grantId = book.issue(conversationId, request.user.id);
        return runResult({
          sessionId,
          reason: 'awaiting_confirmation',
          events: [
            {
              type: 'confirmation_required',
              grantId,
              confirmationId: 'a'.repeat(64),
              tool: ACTION.tool,
              capabilityId: 'journals.create',
              description: 'Post the payroll journal',
              args: {},
            },
          ] as unknown as MsaidiziEvent[],
        });
      },
    });
    return { ...h, book, dispatches };
  }

  function grantOf(result: RunResult): string {
    const proposal = result.events.find((event) => event.type === 'confirmation_required');
    expect(proposal).toBeDefined();
    return (proposal as unknown as { grantId: string }).grantId;
  }

  it('proposes, then executes once, then re-proposes when the same approval is replayed', async () => {
    const s = server();
    const user = authUser();

    // Request 1 — a plain invocation. The step is proposed and a grant issued.
    const proposed = await s.controller.run('proc-7', {} as RunProcedureDto, user, AUTH);
    expect(proposed.reason).toBe('awaiting_confirmation');
    const grantId = grantOf(proposed);
    const sessionId = proposed.sessionId;

    // Request 2 — the approval, on its own HTTP request, carrying the session id
    // that returns it to the conversation the grant was written in.
    const approved = await s.controller.run(
      'proc-7',
      { sessionId, confirmed: [grantId] } as RunProcedureDto,
      user,
      AUTH,
    );
    expect(approved.reason).toBe('end_turn');
    expect(s.dispatches).toHaveLength(1);

    // Request 3 — the identical body again. This is the shape the old design
    // could not see: the spend lived in a `Set` inside `run()` and died at the
    // request boundary, so a client that kept an approval bought one more
    // execution per request it sent. The grant is used now, so the step is
    // proposed again — with a DIFFERENT id, which is what tells the client this
    // is a new question rather than an echo of the answered one.
    const replayed = await s.controller.run(
      'proc-7',
      { sessionId, confirmed: [grantId] } as RunProcedureDto,
      user,
      AUTH,
    );
    expect(replayed.reason).toBe('awaiting_confirmation');
    expect(grantOf(replayed)).not.toBe(grantId);
    expect(s.dispatches).toHaveLength(1);
  });

  it('lets the identical action be approved again under its new grant', async () => {
    const s = server();
    const user = authUser();

    const first = await s.controller.run('proc-7', {} as RunProcedureDto, user, AUTH);
    const sessionId = first.sessionId;
    await s.controller.run(
      'proc-7',
      { sessionId, confirmed: [grantOf(first)] } as RunProcedureDto,
      user,
      AUTH,
    );

    // The same procedure, the same arguments, next week. This is the case that
    // rules out simply remembering a derived id as spent for ever: the id would
    // be identical and the action permanently unapprovable. A fresh nonce per
    // proposal makes "approve once, execute once" and "approvable again" the
    // same rule rather than opposite ones.
    const again = await s.controller.run('proc-7', { sessionId } as RunProcedureDto, user, AUTH);
    expect(again.reason).toBe('awaiting_confirmation');
    const secondGrant = grantOf(again);
    expect(secondGrant).not.toBe(grantOf(first));

    const executed = await s.controller.run(
      'proc-7',
      { sessionId, confirmed: [secondGrant] } as RunProcedureDto,
      user,
      AUTH,
    );
    expect(executed.reason).toBe('end_turn');
    expect(s.dispatches).toHaveLength(2);
  });

  it('refuses a grant carried into a different conversation', async () => {
    const s = server();
    const user = authUser();

    const proposed = await s.controller.run('proc-7', {} as RunProcedureDto, user, AUTH);
    const grantId = grantOf(proposed);

    // Same user, same procedure, same action — a different thread. The store
    // resolves this session id to its own conversation, and the grant was
    // written against another one.
    const elsewhere = await s.controller.run(
      'proc-7',
      { sessionId: mintSessionId(), confirmed: [grantId] } as RunProcedureDto,
      user,
      AUTH,
    );

    expect(elsewhere.reason).toBe('awaiting_confirmation');
    expect(s.dispatches).toHaveLength(0);
    // And the boundary is the conversation the STORE resolved, not one the
    // request named — which is why the controller passes `opened.conversationId`
    // and never anything off the body.
    expect(s.book.rows.get(grantId)?.usedAt).toBeNull();
  });

  it('offers nothing to approve when the turn could not be persisted', async () => {
    const h = harness({
      open: async () => {
        throw new Error('database gone');
      },
      run: async (request) =>
        runResult({
          reason: request.conversationId ? 'awaiting_confirmation' : 'failed',
        }),
    });

    const result = await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // No conversation means no grant, and no grant means the step is not offered
    // at all rather than offered with a button that can never work. The run
    // still happens — reads and amber writes are unaffected — and it still
    // reports, which is why this is a degraded answer and not an outage.
    expect(result.reason).toBe('failed');
    expect(h.service.run.mock.calls[0][0].conversationId).toBeUndefined();
  });
});
