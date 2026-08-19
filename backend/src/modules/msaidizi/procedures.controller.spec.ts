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
 * unapprovable — a fresh id per attempt, so every confirmation id recomputed to
 * something the user had never seen — while the file's own comment claimed the
 * protection it had just lost.
 */

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MsaidiziConversationsService, OpenedTurn } from './conversations.service';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziEvent, MsaidiziService, RunRequest, RunResult } from './msaidizi.service';
import { ProceduresController, RunProcedureDto } from './procedures.controller';
import { ProceduresService } from './procedures.service';

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
    run: jest.fn(async (_request: RunRequest, _emit?: (event: MsaidiziEvent) => void) => {
      trace.push('run');
      return result;
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

    const result = await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

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
    expect(h.conversations.close).toHaveBeenCalledWith(h.opened, result);
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
    // and under a write mode would hide a change that did.
    await expect(
      h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH),
    ).resolves.toEqual(h.result);
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

describe('an approval resubmitted to a procedure run keeps the session id it was approved under', () => {
  /** A store that honours a client's session id, as the real one does. */
  function honouring() {
    return harness({
      open: async (input) =>
        openedTurn({
          sessionId: (input as { clientSessionId?: string }).clientSessionId ?? 'ms_minted',
        }),
    });
  }

  it('runs under the id the client echoed back, not one minted for the attempt', async () => {
    const h = honouring();

    await h.controller.run(
      'proc-7',
      { sessionId: 'ms_suspended', confirmed: ['confirm_1'] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // `confirmationIdFor()` derives every red-tier id from the session id. A run
    // under a fresh id recomputes ids that cannot match the ones the user just
    // approved, so it suspends again on the same action — and each attempt
    // leaves another conversation row behind. This controller passed nothing at
    // all, which made that loop unbreakable from the API.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: 'ms_suspended' }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_suspended');
    expect(h.service.run.mock.calls[0][0].confirmed).toEqual(['confirm_1']);
  });

  it('keeps that id even when the store cannot open a turn for the attempt', async () => {
    const h = harness({
      open: async () => {
        throw new Error('database gone');
      },
    });

    await h.controller.run(
      'proc-7',
      { sessionId: 'ms_suspended', confirmed: ['confirm_1'] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // The approval has to survive a store outage too: the ids the user approved
    // were derived from this id, and nothing about a failed history write makes
    // them derivable from a different one.
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_suspended');
  });

  it('starts a fresh conversation for a plain invocation, which carries no id', async () => {
    const h = honouring();

    await h.controller.run('proc-7', {} as RunProcedureDto, authUser(), AUTH);

    // The other half: a procedure invoked normally is a new run, and must not
    // be filed into whatever conversation ran it last.
    expect(h.conversations.open).toHaveBeenCalledWith(
      expect.objectContaining({ clientSessionId: undefined }),
    );
    expect(h.service.run.mock.calls[0][0].sessionId).toBe('ms_minted');
  });

  it('sends the model the working state the store handed back, not the instruction alone', async () => {
    const suspended = [
      { role: 'user' as const, content: 'Reconcile the supplier ledger.' },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: 'tu_1' }] },
    ];
    const h = harness({ open: async () => openedTurn({ history: suspended, fromServer: true }) });

    await h.controller.run(
      'proc-7',
      { sessionId: 'ms_suspended', confirmed: ['confirm_1'] } as RunProcedureDto,
      authUser(),
      AUTH,
    );

    // Re-deriving the action from the instruction alone would work only as long
    // as the model made the identical choice twice; resuming from what it
    // already proposed is what makes the approved id reachable at all.
    expect(h.service.run.mock.calls[0][0].messages).toEqual([
      ...suspended,
      { role: 'user', content: 'Reconcile the supplier ledger.' },
    ]);
  });
});
