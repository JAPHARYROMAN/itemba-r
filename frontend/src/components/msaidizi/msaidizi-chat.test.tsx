/**
 * The chat, wired end to end — everything except the socket.
 *
 * The transport is doubled at `streamMsaidiziAsk`, which is the seam between
 * "what the browser sends" and "what the network does". Everything below it —
 * the orchestrator, the reducer, the selectors, the thread — is the real thing,
 * so these tests assert on the REQUEST BODIES the page would put on the wire.
 *
 * CHAT-1  A question runs a turn and the answer lands in the thread.
 * CHAT-2  The standing mode line comes from `GET /msaidizi/capabilities`, never
 *         from a string in the page. Hardcoding it is the single easiest way to
 *         ship a lie the day the deployment moves to amber.
 * CHAT-3  ══ THE ONE-SHOT ══ an approval is spent on exactly one request and is
 *         never carried into the next. A client that parks `confirmed` in state
 *         puts a standing "yes" for that action on every later turn of the run,
 *         and this page never asked the user for one: it asked once, about one
 *         proposal. What the server makes of an id it has already honoured is a
 *         policy that has changed before and is not what this is resting on.
 * CHAT-4  `history` is echoed back BY REFERENCE. Not mapped, not cloned, not
 *         re-typed. The provider's content blocks must survive the round trip
 *         untouched, and normalising them broke multi-turn completely once.
 * CHAT-5  A stored conversation the server can no longer resume is readable and
 *         not continuable, and the composer says why instead of failing later.
 * CHAT-5b The same conversation when the server CAN still resume it: the
 *         composer stays open and the follow-up goes up as a `conversationId`
 *         plus the sequence this tab last saw, with no `history` at all.
 * CHAT-6  ══ THE GUARD ══ a run that did work and never reported its `messages`
 *         closes EVERY door that starts a turn, not just the composer. The gate's
 *         Approve and the notice's "Ask again" both call `ask()`, so both send a
 *         history the app has already decided is broken — and approving from
 *         there is the worst of them, because the model would receive a yes to a
 *         question it has no record of asking and be left to reconstruct an
 *         irreversible action from the sentence in the approval message.
 * CHAT-7  A failed capabilities check is recoverable from the page. One dropped
 *         request must not brick the page until someone thinks to press F5.
 * CHAT-8  The empty state promises only what the trace actually carries.
 * CHAT-9  ══ THE GATE ══ a red proposal raised by a turn THIS TAB ran gets its
 *         buttons wherever the thread came from, and one read back out of the
 *         store gets the record. The page used to decide that on `storedId`,
 *         which stopped being the same answer the moment a reopened
 *         conversation could take a turn at all.
 * CHAT-10 Removing the conversation you are IN clears it. The id lives in the
 *         `session` frame, not in `storedId`, so the thread that a delete
 *         bricks is the one the page had no record of having opened.
 * CHAT-11 The rail is refreshed when a turn settles, not on mount alone.
 * CHAT-12 A run whose session id never arrived says so, instead of saying no id
 *         has been minted yet — under a notice saying its changes are recorded.
 * CHAT-13 ══ THE SECOND ASK ══ the approved action is carried out and the same
 *         action is proposed again in the same turn. The screen must not read as
 *         a duplicate or as a gate that ignored the click, because the only way
 *         a user clears either of those is by approving again.
 * CHAT-14 ══ THE GRANT ══ `confirmed` carries the server's own nonce and nothing
 *         this page could have worked out for itself. The shape that matters is
 *         the same action across two separate REQUESTS: a refused grant comes
 *         back as a fresh proposal with a fresh id, and re-sending the first —
 *         by parking it, or by recomputing the derived id, which is identical on
 *         both — is one approval buying two executions a request apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MsaidiziStreamOutcome } from '@/lib/msaidizi-stream';
import type {
  MsaidiziAskRequest,
  MsaidiziCapabilities,
  MsaidiziConversationDetail,
  MsaidiziConversationSummary,
  MsaidiziEvent,
  MsaidiziSessionFrame,
  ModelMessage,
} from '@/lib/msaidizi-types';
import { MsaidiziChat } from './msaidizi-chat';

/* ------------------------------------------------------------------------ *
 * Doubles
 * ------------------------------------------------------------------------ */
const h = vi.hoisted(() => ({
  stream: vi.fn(),
  capabilities: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/msaidizi-stream', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/msaidizi-stream')>('@/lib/msaidizi-stream');
  return { ...actual, streamMsaidiziAsk: h.stream };
});

vi.mock('@/lib/msaidizi-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/msaidizi-client')>('@/lib/msaidizi-client');
  return {
    ...actual,
    fetchMsaidiziCapabilities: h.capabilities,
    listMsaidiziConversations: h.list,
    fetchMsaidiziConversation: h.detail,
    deleteMsaidiziConversation: h.remove,
  };
});

const CAPABILITIES: MsaidiziCapabilities = {
  enabled: true,
  writeMode: 'read-only',
  allowedTiers: ['green'],
  budgets: { maxToolCalls: 40, maxWrites: 10, toolBudget: 60 },
  narrowing: { active: false, permitted: 12, perRun: 12 },
  capabilities: [
    {
      name: 'SupplierInvoices_findAll',
      description: 'List all supplier invoices',
      tier: 'green',
      path: 'GET /supplier-invoices',
      capabilityId: 'SupplierInvoicesController.findAll',
    },
  ],
};

/**
 * One scripted run: emit these events, then settle with this reason.
 *
 * `session` is the frame the real stream writes before anything else, and the
 * only place a conversation created by asking here is ever named — nothing in
 * the page mints that id and the read endpoints are not consulted for it.
 */
function scriptRun(
  events: MsaidiziEvent[],
  reason: string,
  messages: ModelMessage[] = [],
  session: MsaidiziSessionFrame | null = null,
) {
  return async (
    _request: MsaidiziAskRequest,
    handlers: {
      onEvent?: (e: MsaidiziEvent) => void;
      onResult?: (r: unknown) => void;
      onSession?: (s: MsaidiziSessionFrame) => void;
    } = {},
  ): Promise<MsaidiziStreamOutcome> => {
    if (session) handlers.onSession?.(session);
    for (const event of events) handlers.onEvent?.(event);
    const result = {
      sessionId: 'ms_test',
      events,
      reason,
      messages,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        modelTurns: 1,
      },
    };
    handlers.onResult?.(result);
    return {
      termination: { kind: 'done', reason } as MsaidiziStreamOutcome['termination'],
      events,
      result: result as MsaidiziStreamOutcome['result'],
      session,
      malformedFrames: 0,
      unknownFrames: 0,
      durationMs: 900,
    };
  };
}

/**
 * One run whose `result` frame never landed.
 *
 * The events stream, the verdict is reported, and the `messages` array — by far
 * the largest write of the run, and the only carrier of the session id — does
 * not arrive. That is the real shape of a socket dropped during the final write,
 * and it is the state `historyComplete` exists to record: the run did work this
 * thread can no longer describe back to the model.
 */
function scriptLostRun(events: MsaidiziEvent[], termination: MsaidiziStreamOutcome['termination']) {
  return async (
    _request: MsaidiziAskRequest,
    handlers: { onEvent?: (e: MsaidiziEvent) => void } = {},
  ): Promise<MsaidiziStreamOutcome> => {
    for (const event of events) handlers.onEvent?.(event);
    return {
      termination,
      events,
      result: null,
      session: null,
      malformedFrames: 0,
      unknownFrames: 0,
      durationMs: 900,
    };
  };
}

const bodies = (): MsaidiziAskRequest[] => h.stream.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  h.capabilities.mockResolvedValue(CAPABILITIES);
  h.list.mockResolvedValue({ data: [], meta: { page: 1, limit: 30, total: 0 } });
});

/**
 * Type a question and send it.
 *
 * Waits for the composer to be usable first: it is gated on the capabilities
 * answer, deliberately, so that nobody learns the module is switched off by
 * watching their own question fail.
 */
async function ask(question: string) {
  const box = await screen.findByRole('textbox', { name: 'Ask Msaidizi' });
  await waitFor(() => expect(box).toBeEnabled());
  await userEvent.type(box, `${question}{Enter}`);
}

/**
 * The row for one conversation in the sibling module's list.
 *
 * By text rather than by accessible name: the row button's name is the title
 * plus its activity line plus its chips, and its sibling remove button is named
 * "Remove <title>" — so a name regex matches two elements and neither exactly.
 */
async function conversationItem(title: string) {
  const label = await screen.findByText(title);
  const button = label.closest('button');
  if (!button) throw new Error(`No conversation row found for ${title}`);
  return button;
}

/* ------------------------------------------------------------------------ *
 * CHAT-1 · A question becomes a turn
 * ------------------------------------------------------------------------ */

describe('CHAT-1 · asking runs a turn and renders it', () => {
  it('sends the message and lands the answer in the thread', async () => {
    h.stream.mockImplementation(
      scriptRun(
        [
          {
            type: 'tool_call',
            tool: 'SupplierInvoices_findAll',
            capabilityId: 'SupplierInvoicesController.findAll',
            tier: 'green',
            args: {},
          },
          { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
          { type: 'text', text: 'TZS 4,180,000 across three suppliers.' },
          { type: 'done', reason: 'end_turn' },
        ],
        'end_turn',
      ),
    );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    await screen.findByTestId('msaidizi-answer');
    expect(bodies()[0]).toEqual({ message: 'How much do we owe suppliers?' });
    // The capabilities lookup reached the step row, so it reads as words.
    expect(screen.getByTestId('msaidizi-step')).toHaveTextContent(
      'Looked at list all supplier invoices',
    );
  });

  it('runs the launcher question once, on mount, without being typed', async () => {
    h.stream.mockImplementation(
      scriptRun(
        [
          { type: 'text', text: 'Here you go.' },
          { type: 'done', reason: 'end_turn' },
        ],
        'end_turn',
      ),
    );

    render(<MsaidiziChat initialQuestion="What did we sell yesterday?" />);

    await screen.findByTestId('msaidizi-answer');
    expect(h.stream).toHaveBeenCalledTimes(1);
    expect(bodies()[0].message).toBe('What did we sell yesterday?');
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-2 · The mode line is the server's, not the page's
 * ------------------------------------------------------------------------ */

describe('CHAT-2 · what the page says about itself comes from the server', () => {
  it('says it cannot change anything under read-only', async () => {
    render(<MsaidiziChat />);
    const banner = await screen.findByLabelText('What Msaidizi can do');
    await waitFor(() => expect(banner).toHaveTextContent('It cannot change anything.'));
  });

  it('stops saying that the moment the deployment reports amber', async () => {
    h.capabilities.mockResolvedValue({
      ...CAPABILITIES,
      writeMode: 'amber',
      allowedTiers: ['green', 'amber'],
    });

    render(<MsaidiziChat />);

    const banner = await screen.findByLabelText('What Msaidizi can do');
    await waitFor(() => expect(banner).toHaveTextContent(/can make changes you could undo/i));
    expect(banner).not.toHaveTextContent('It cannot change anything.');
  });

  it('always says reads are not audited, because they are not', async () => {
    render(<MsaidiziChat />);
    expect(await screen.findByLabelText('What Msaidizi can do')).toHaveTextContent(
      /what msaidizi read is not recorded in the audit log/i,
    );
  });

  it('warns when the tool set is being narrowed, since a run gives no other signal', async () => {
    h.capabilities.mockResolvedValue({
      ...CAPABILITIES,
      narrowing: { active: true, permitted: 1001, perRun: 60 },
    });

    render(<MsaidiziChat />);
    const banner = await screen.findByLabelText('What Msaidizi can do');
    await waitFor(() => expect(banner).toHaveTextContent(/60 of the 1001 tools/i));
  });

  it('says so, rather than falling back to the read-only sentence, when the call fails', async () => {
    h.capabilities.mockRejectedValue(new Error('Service unavailable'));

    render(<MsaidiziChat />);

    const banner = await screen.findByLabelText('What Msaidizi can do');
    await waitFor(() => expect(banner).toHaveTextContent(/could not check what msaidizi can do/i));
    // Guessing "it cannot change anything" without having asked is the exact lie
    // the capabilities endpoint was added to prevent.
    expect(banner).not.toHaveTextContent('It cannot change anything.');
    // And nothing may be sent into a deployment whose mode is unknown.
    expect(await screen.findByRole('textbox', { name: 'Ask Msaidizi' })).toBeDisabled();
  });

  it('refuses to send anything at all when the module reports itself off', async () => {
    h.capabilities.mockResolvedValue({ ...CAPABILITIES, enabled: false });

    render(<MsaidiziChat />);

    const blocked = await screen.findByTestId('msaidizi-composer-blocked');
    expect(blocked).toHaveTextContent(/switched off in this deployment/i);
    expect(h.stream).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-3 · The one-shot
 * ------------------------------------------------------------------------ */

describe('CHAT-3 · an approval is spent once and never carried forward', () => {
  const SUSPENDED: MsaidiziEvent[] = [
    { type: 'text', text: 'I can delete invoice 41. Confirm and I will.' },
    {
      type: 'confirmation_required',
      grantId: 'grt_9e41c0b7d2',
      confirmationId: 'cnf_Invoices_remove_1a2b3c',
      tool: 'Invoices_remove',
      capabilityId: 'InvoicesController.remove',
      description: 'Delete invoice with id 41',
      args: { id: '41' },
    },
    { type: 'done', reason: 'awaiting_confirmation' },
  ];

  it('sends confirmed on the resuming turn and on no turn after it', async () => {
    h.stream
      .mockImplementationOnce(scriptRun(SUSPENDED, 'awaiting_confirmation'))
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Deleted.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Nothing else.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    await userEvent.click(within(gate).getByRole('checkbox'));
    await userEvent.click(screen.getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    // The SERVER'S grant, not the derived id sitting on the same event. The
    // derived id is deterministic — this page could compute it from the tool and
    // the arguments it already has — which is exactly why it is no longer what
    // authorises anything, and why sending it would be sending something this
    // page made up.
    expect(bodies()[1].confirmed).toEqual(['grt_9e41c0b7d2']);
    expect(JSON.stringify(bodies()[1])).not.toContain('cnf_Invoices_remove_1a2b3c');
    // The message records WHAT was consented to. "Yes, go ahead." in a stored
    // transcript is evidence of nothing — and a bare "yes" has been measured to
    // narrow the confirmed tool straight back out of the registry.
    expect(bodies()[1].message).toContain('Delete invoice with id 41');

    await ask('and what about invoice 42?');
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));
    expect(bodies()[2].confirmed).toBeUndefined();
  });

  it('declines without sending an approval', async () => {
    h.stream
      .mockImplementationOnce(scriptRun(SUSPENDED, 'awaiting_confirmation'))
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Understood.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    await screen.findByTestId('msaidizi-confirmation-gate');
    await userEvent.click(screen.getByTestId('msaidizi-decline'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(bodies()[1].confirmed).toBeUndefined();
    expect(bodies()[1].message).toMatch(/do not go ahead/i);
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-4 · History is echoed, not rebuilt
 * ------------------------------------------------------------------------ */

describe('CHAT-4 · the model conversation is echoed back by reference', () => {
  it('sends the previous run’s messages array itself, unmapped', async () => {
    // A provider content block with fields no frontend type knows about. If
    // anything between here and the request body maps, clones or re-types this,
    // those fields are gone and multi-turn breaks — which has happened before.
    const messages: ModelMessage[] = [
      { role: 'user', content: 'How much do we owe suppliers?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look.' },
          {
            type: 'tool_use',
            id: 'toolu_01ABC',
            name: 'SupplierInvoices_findAll',
            input: {},
            cache_control: null,
            unknown_provider_field: 'must survive',
          },
        ],
      },
    ];

    h.stream
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Done.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
          messages,
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Again.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');
    await screen.findByTestId('msaidizi-answer');

    await ask('and last month?');
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));

    // Identity, not equality: the array reference itself made the round trip.
    expect(bodies()[1].history).toBe(messages);
    expect(bodies()[1].sessionId).toBe('ms_test');
  });

  it('never renders the transport state, which carries the retrieved records', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01ABC',
            content: 'SECRET-SUPPLIER-BALANCE-9,912,000',
          },
        ],
      },
    ];

    h.stream.mockImplementation(
      scriptRun(
        [
          { type: 'text', text: 'Done.' },
          { type: 'done', reason: 'end_turn' },
        ],
        'end_turn',
        messages,
      ),
    );

    const { container } = render(<MsaidiziChat />);
    await ask('totals');
    await screen.findByTestId('msaidizi-answer');

    expect(container.textContent).not.toContain('SECRET-SUPPLIER-BALANCE');
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-5 · A stored conversation
 * ------------------------------------------------------------------------ */

describe('CHAT-5 · a saved conversation is readable and not continuable', () => {
  const DETAIL: MsaidiziConversationDetail = {
    id: 'conv_1',
    agentSessionId: 'ms_stored',
    title: 'Supplier balances',
    companyId: 'c1',
    turnCount: 1,
    toolCallCount: 2,
    writeCallCount: 0,
    highestTier: 'green',
    resumable: false,
    continuable: false,
    lastTurnAt: '2026-08-17T09:00:00.000Z',
    createdAt: '2026-08-17T09:00:00.000Z',
    expiresAt: '2026-11-15T09:00:00.000Z',
    turns: [
      {
        id: 'turn_1',
        sequence: 1,
        prompt: 'How much do we owe suppliers?',
        reason: 'end_turn',
        toolCallCount: 1,
        writeCallCount: 0,
        procedureId: null,
        startedAt: '2026-08-17T09:00:00.000Z',
        endedAt: '2026-08-17T09:00:04.000Z',
        events: [
          {
            type: 'tool_call',
            tool: 'SupplierInvoices_findAll',
            capabilityId: 'SupplierInvoicesController.findAll',
            tier: 'green',
            args: {},
          },
          { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
          { type: 'text', text: 'TZS 4,180,000 across three suppliers.' },
          { type: 'done', reason: 'end_turn' },
        ],
      },
    ],
  };

  beforeEach(() => {
    h.list.mockResolvedValue({
      data: [
        {
          id: 'conv_1',
          agentSessionId: 'ms_stored',
          title: 'Supplier balances',
          companyId: 'c1',
          turnCount: 1,
          toolCallCount: 2,
          writeCallCount: 0,
          highestTier: 'green',
          resumable: false,
          continuable: false,
          lastTurnAt: '2026-08-17T09:00:00.000Z',
          createdAt: '2026-08-17T09:00:00.000Z',
          expiresAt: '2026-11-15T09:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 30, total: 1 },
    });
    h.detail.mockResolvedValue(DETAIL);
  });

  it('renders the stored transcript with its steps still inline', async () => {
    render(<MsaidiziChat />);

    await userEvent.click(await conversationItem('Supplier balances'));

    await screen.findByTestId('msaidizi-answer');
    expect(screen.getByTestId('msaidizi-step')).toHaveTextContent(
      'Looked at list all supplier invoices',
    );
  });

  it('blocks the composer and says why, rather than failing on the next turn', async () => {
    render(<MsaidiziChat />);
    await userEvent.click(await conversationItem('Supplier balances'));

    // `hydrateFromConversation` yields history: [] on purpose — the transcript
    // carries no tool_use ids and no result bodies, and synthesising a history
    // from it would hand the model invented data to answer from.
    const blocked = await screen.findByTestId('msaidizi-composer-blocked');
    expect(blocked).toHaveTextContent(/start a new conversation/i);
    expect(screen.getByRole('textbox', { name: 'Ask Msaidizi' })).toBeDisabled();
    expect(h.stream).not.toHaveBeenCalled();
  });

  it('says what removing does and does not do', async () => {
    render(<MsaidiziChat />);
    await userEvent.click(await screen.findByLabelText(/remove supplier balances/i));

    const dialog = await screen.findByText(
      /removing the chat changes nothing about what is on record/i,
    );
    expect(dialog).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-5b · A stored conversation the server CAN still resume
 * ------------------------------------------------------------------------ */

/**
 * The other half of CHAT-5, and the reason `continuable` is on the wire at all.
 *
 * Reopening a conversation used to close the composer unconditionally, on the
 * reasoning that `hydrateFromConversation` yields `history: []` and a turn built
 * on an empty history would silently drop everything that came before. That
 * reasoning ended when the server began accepting `conversationId` on AskDto and
 * routing it to the one path that reads server-held resume state: the client was
 * never the party that had to hold `messages`, which is why the read endpoint
 * does not return them.
 *
 * So the question is not "did this come from the rail" but "does the server still
 * hold it", and `continuable` is the server's own answer. This asserts the wire
 * body, because that is where the difference actually lives: identified by id,
 * not re-narrated from a copy this tab happens to have.
 */
describe('CHAT-5b · a saved conversation the server still holds is continued by id', () => {
  const SUMMARY = {
    id: 'conv_2',
    agentSessionId: 'ms_stored_live',
    title: 'Overdue invoices',
    companyId: 'c1',
    turnCount: 1,
    toolCallCount: 1,
    writeCallCount: 0,
    highestTier: 'green',
    resumable: true,
    continuable: true,
    lastTurnAt: '2026-08-18T09:00:00.000Z',
    createdAt: '2026-08-18T09:00:00.000Z',
    expiresAt: '2026-11-16T09:00:00.000Z',
  };

  const DETAIL: MsaidiziConversationDetail = {
    ...SUMMARY,
    turns: [
      {
        id: 'turn_1',
        sequence: 1,
        prompt: 'Which invoices are unpaid?',
        reason: 'end_turn',
        toolCallCount: 1,
        writeCallCount: 0,
        procedureId: null,
        startedAt: '2026-08-18T09:00:00.000Z',
        endedAt: '2026-08-18T09:00:04.000Z',
        events: [
          { type: 'text', text: 'Four are unpaid.' },
          { type: 'done', reason: 'end_turn' },
        ],
      },
    ],
  };

  beforeEach(() => {
    h.list.mockResolvedValue({ data: [SUMMARY], meta: { page: 1, limit: 30, total: 1 } });
    h.detail.mockResolvedValue(DETAIL);
    h.stream.mockImplementation(
      scriptRun(
        [
          { type: 'text', text: 'Two of them are overdue.' },
          { type: 'done', reason: 'end_turn' },
        ],
        'end_turn',
      ),
    );
  });

  it('leaves the composer open and continues by id, sending no history', async () => {
    render(<MsaidiziChat />);
    await userEvent.click(await conversationItem('Overdue invoices'));
    await screen.findByTestId('msaidizi-answer');

    // No blocking sentence: the server says it can still be picked up, and a
    // composer closed here would be the send button lying in the other
    // direction — refusing a follow-up the server would have accepted.
    expect(screen.queryByTestId('msaidizi-composer-blocked')).toBeNull();

    await ask('which of those are overdue?');
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));

    const [request] = bodies();
    // Identified, not re-narrated. `history` is absent because this tab has
    // none to send, and the server does not need it to answer.
    expect(request.conversationId).toBe('conv_2');
    expect(request.history).toBeUndefined();
    // The sequence this tab last saw. The server answers 409 when the
    // conversation has moved on in another window, which it cannot do if the
    // client never states where it thinks the thread is.
    expect(request.sequence).toBe(1);
    // The stored session id, so the audit rows stay under one key.
    expect(request.sessionId).toBe('ms_stored_live');
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-6 · The guard on every door
 * ------------------------------------------------------------------------ */

describe('CHAT-6 · a lost run closes every control that would start a turn', () => {
  const PROPOSED: MsaidiziEvent[] = [
    { type: 'text', text: 'I can delete invoice 41. Confirm and I will.' },
    {
      type: 'confirmation_required',
      grantId: 'grt_lostrun_4a17',
      confirmationId: 'cnf_Invoices_remove_1a2b3c',
      tool: 'Invoices_remove',
      capabilityId: 'InvoicesController.remove',
      description: 'Delete invoice with id 41',
      args: { id: '41' },
    },
    { type: 'done', reason: 'awaiting_confirmation' },
  ];

  // The `done` frame is ~40 bytes and `result` carries the whole `messages`
  // array, so the socket dropping between them is the ordinary case, not an
  // exotic one. Approving here sends a history missing the exchange that
  // produced the proposal, with no session id — the server mints a fresh one,
  // recomputes every confirmation id off it, matches nothing, and suspends
  // again. That is the infinite approval loop, one enabled button away.
  it('kills the gate’s buttons, in the box, when the run never reported its messages', async () => {
    h.stream.mockImplementation(
      scriptLostRun(PROPOSED, { kind: 'done', reason: 'awaiting_confirmation' }),
    );

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    // The proposal stays on screen — it is the evidence a reviewer needs most,
    // and a decision box that vanishes without a word is how a user concludes
    // they approved something. What goes is the ability to act on it, and the
    // sentence saying why sits inside the box rather than only under it.
    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    expect(gate).toHaveTextContent('Delete invoice with id 41');
    expect(within(gate).getByTestId('msaidizi-approve')).toBeDisabled();
    expect(within(gate).getByTestId('msaidizi-decline')).toBeDisabled();
    expect(gate).toHaveTextContent(/can no longer be approved from here/i);

    expect(await screen.findByTestId('msaidizi-composer-blocked')).toHaveTextContent(
      /can no longer be approved from here/i,
    );
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  // `historyComplete` goes false for two situations with opposite facts in them,
  // and the one sentence that used to cover both is false for this one. `run()`
  // takes no `AbortSignal`, so a dropped socket loses the view and nothing else:
  // the run is executing on the server right now and the server WILL record the
  // exchange. Telling the user Msaidizi "can no longer be told what happened in
  // it" describes the opposite system, and the action it implies — go and redo
  // it — is the one action that starts a second run beside the first.
  it('says a disconnected run is still finishing rather than lost', async () => {
    h.stream.mockImplementation(
      scriptLostRun(
        [
          {
            type: 'tool_call',
            tool: 'SupplierInvoices_findAll',
            capabilityId: 'SupplierInvoicesController.findAll',
            tier: 'green',
            args: {},
          },
        ],
        { kind: 'disconnected', message: 'The connection dropped.' },
      ),
    );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    const blocked = await screen.findByTestId('msaidizi-composer-blocked');
    expect(blocked).toHaveTextContent(/still finishing on the server/i);
    // The claim that is untrue of a run that is still going.
    expect(blocked.textContent ?? '').not.toMatch(/can no longer be told what happened/i);
    // And the reason not to retype the question is the real one — a second run
    // beside the first — not a claim that the first one evaporated.
    expect(blocked).toHaveTextContent(/second run/i);
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  it('offers no “Ask again” after a stream_failed run that had already called tools', async () => {
    h.stream.mockImplementation(
      scriptLostRun(
        [
          {
            type: 'tool_call',
            tool: 'SupplierInvoices_findAll',
            capabilityId: 'SupplierInvoicesController.findAll',
            tier: 'green',
            args: {},
          },
          { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
          { type: 'error', message: 'The run stopped unexpectedly.' },
        ],
        { kind: 'stream_failed', message: 'The run stopped unexpectedly.' },
      ),
    );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    await screen.findByTestId('msaidizi-terminal-notice');
    // Two contradictory instructions on one screen is the defect: the composer
    // says start a new conversation, and a button beside it re-drives the run.
    expect(screen.queryByRole('button', { name: /ask again/i })).toBeNull();
    expect(await screen.findByTestId('msaidizi-composer-blocked')).toHaveTextContent(
      /start a new conversation/i,
    );
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  // The control, and the reason the guard is `historyComplete` rather than "did
  // this fail": a run that never started left the prefix exactly as it was, so
  // continuing from it is still honest and the retry must survive.
  it('keeps “Ask again” when the run left no hole, and re-sends the prompt', async () => {
    h.stream
      .mockImplementationOnce(
        scriptLostRun([], {
          kind: 'unavailable',
          status: null,
          cause: 'network',
          message: 'Could not reach Msaidizi.',
        }),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'TZS 4,180,000 across three suppliers.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    await screen.findByTestId('msaidizi-terminal-notice');
    const retry = screen.getByRole('button', { name: /ask again/i });
    expect(screen.queryByTestId('msaidizi-composer-blocked')).toBeNull();

    await userEvent.click(retry);
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(bodies()[1].message).toBe('How much do we owe suppliers?');
  });

  // `canContinue()` is `historyComplete && !isRunning`, and this is the second
  // half. There is no sentence to show here — the composer is held by `busy`,
  // not by a reason — so the notice's own block cannot cover it, and a live run
  // with a live "Ask again" beside it is how one question becomes two runs.
  it('takes “Ask again” away while another run is live', async () => {
    h.stream
      .mockImplementationOnce(
        scriptLostRun([], {
          kind: 'unavailable',
          status: null,
          cause: 'network',
          message: 'Could not reach Msaidizi.',
        }),
      )
      // Never settles: the second run is still on the wire for the rest of this.
      .mockImplementationOnce(() => new Promise<never>(() => {}));

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    await screen.findByTestId('msaidizi-terminal-notice');
    await userEvent.click(screen.getByRole('button', { name: /ask again/i }));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole('button', { name: /ask again/i })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-7 · The capabilities check is retryable
 * ------------------------------------------------------------------------ */

describe('CHAT-7 · a failed capabilities check can be re-attempted in the page', () => {
  it('retries the check and unblocks the page once it answers', async () => {
    h.capabilities.mockRejectedValueOnce(new Error('Service unavailable'));
    h.capabilities.mockResolvedValue(CAPABILITIES);

    render(<MsaidiziChat />);

    await waitFor(() =>
      expect(screen.getByLabelText('What Msaidizi can do')).toHaveTextContent(
        /could not check what msaidizi can do/i,
      ),
    );
    // The banner must not say the check failed while the composer says it is
    // still running — that pair is what leaves the user with nothing to do.
    const blocked = await screen.findByTestId('msaidizi-composer-blocked');
    expect(blocked).not.toHaveTextContent(/still checking/i);

    await userEvent.click(screen.getByTestId('msaidizi-capabilities-retry'));

    await waitFor(() =>
      expect(screen.getByLabelText('What Msaidizi can do')).toHaveTextContent(
        'It cannot change anything.',
      ),
    );
    expect(h.capabilities).toHaveBeenCalledTimes(2);
    const box = await screen.findByRole('textbox', { name: 'Ask Msaidizi' });
    await waitFor(() => expect(box).toBeEnabled());
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-8 · The empty state
 * ------------------------------------------------------------------------ */

describe('CHAT-8 · the empty state promises only what the trace carries', () => {
  // `tool_result` records `{tool, ok, status, error}` and the payload is
  // discarded on purpose, so the trace cannot leak a record. An opening line
  // promising record-level detail sets up the one expectation the feature is
  // built never to meet, and invites the "view results" affordance §2.4 forbids.
  it('does not promise the records the trace deliberately discards', async () => {
    render(<MsaidiziChat />);

    const intro = await screen.findByText(/it looks things up with your own permissions/i);
    expect(intro).toHaveTextContent(
      'The steps say what it touched; the answer says what it found.',
    );
    expect(intro).not.toHaveTextContent(/every record it touched/i);
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-9 · The gate belongs to the turn, not to the thread
 * ------------------------------------------------------------------------ */

/**
 * A reopened conversation can take a turn, so a reopened conversation can raise
 * a red-tier proposal — and whether that proposal is offered as a decision is a
 * question about the turn that raised it, not about where the thread came from.
 *
 * The page used to withhold the gate on `storedId` alone, which was the same
 * answer only for as long as reopening closed the composer. Once a stored
 * conversation could be continued by id, that test made a LIVE irreversible
 * proposal unapprovable and undeclinable, with a past-tense record in place of
 * the gate telling the user "if it was approved, it ran in the next one" — about
 * a decision nobody was ever offered. Both directions are pinned below, because
 * a fix that simply always passes the pending list breaks the other one.
 */
const REOPENED: MsaidiziConversationSummary = {
  id: 'conv_3',
  agentSessionId: 'ms_reopened',
  title: 'Duplicate invoices',
  companyId: 'c1',
  turnCount: 1,
  toolCallCount: 1,
  writeCallCount: 0,
  highestTier: 'green',
  resumable: true,
  continuable: true,
  lastTurnAt: '2026-08-18T09:00:00.000Z',
  createdAt: '2026-08-18T09:00:00.000Z',
  expiresAt: '2026-11-16T09:00:00.000Z',
};

const PROPOSAL: MsaidiziEvent = {
  type: 'confirmation_required',
  grantId: 'grt_88_c30f1a94',
  confirmationId: 'cnf_Invoices_remove_9f8e7d',
  tool: 'Invoices_remove',
  capabilityId: 'InvoicesController.remove',
  description: 'Delete invoice with id 88',
  args: { id: '88' },
};

describe('CHAT-9 · a live proposal in a reopened conversation is still a decision', () => {
  const ANSWERED: MsaidiziConversationDetail = {
    ...REOPENED,
    turns: [
      {
        id: 'turn_1',
        sequence: 1,
        prompt: 'Are any invoices duplicated?',
        reason: 'end_turn',
        toolCallCount: 1,
        writeCallCount: 0,
        procedureId: null,
        startedAt: '2026-08-18T09:00:00.000Z',
        endedAt: '2026-08-18T09:00:04.000Z',
        events: [
          { type: 'text', text: 'Invoice 88 looks like a duplicate of 87.' },
          { type: 'done', reason: 'end_turn' },
        ],
      },
    ],
  };

  const SUSPENDED_STORE: MsaidiziConversationDetail = {
    ...REOPENED,
    turns: [
      {
        ...ANSWERED.turns[0],
        reason: 'awaiting_confirmation',
        events: [
          { type: 'text', text: 'I can delete invoice 88. Confirm and I will.' },
          PROPOSAL,
          { type: 'done', reason: 'awaiting_confirmation' },
        ],
      },
    ],
  };

  beforeEach(() => {
    h.list.mockResolvedValue({ data: [REOPENED], meta: { page: 1, limit: 30, total: 1 } });
  });

  it('offers Approve and Decline for a proposal this tab’s own turn raised', async () => {
    h.detail.mockResolvedValue(ANSWERED);
    h.stream
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'I can delete invoice 88. Confirm and I will.' },
            PROPOSAL,
            { type: 'done', reason: 'awaiting_confirmation' },
          ],
          'awaiting_confirmation',
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Deleted.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await userEvent.click(await conversationItem('Duplicate invoices'));
    await screen.findByTestId('msaidizi-answer');

    await ask('delete the duplicate');

    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    expect(gate).toHaveTextContent('Delete invoice with id 88');
    expect(within(gate).getByTestId('msaidizi-decline')).toBeEnabled();
    // Nothing in the transcript claims this may already have been decided: the
    // record is what the thread renders INSTEAD of a gate, and this proposal is
    // still waiting on the person reading it.
    expect(screen.queryByTestId('msaidizi-confirmation-record')).toBeNull();

    await userEvent.click(within(gate).getByRole('checkbox'));
    await userEvent.click(within(gate).getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    // The grant this proposal was issued with, carried through a REOPENED
    // conversation. The grant is bound to the conversation, so an approval sent
    // from here without `conversationId` would be offered against the wrong
    // thread — which is why the body is checked for both.
    expect(bodies()[1].confirmed).toEqual(['grt_88_c30f1a94']);
    expect(bodies()[1].conversationId).toBe('conv_3');
  });

  it('leaves a proposal read back out of the store as a record, with no buttons', async () => {
    h.detail.mockResolvedValue(SUSPENDED_STORE);

    render(<MsaidiziChat />);
    await userEvent.click(await conversationItem('Duplicate invoices'));

    const record = await screen.findByTestId('msaidizi-confirmation-record');
    expect(record).toHaveTextContent('Delete invoice with id 88');
    expect(screen.queryByTestId('msaidizi-confirmation-gate')).toBeNull();
    // `continuable` is true here deliberately: this conversation CAN take
    // another turn, so nothing about the composer separates the two cases. What
    // makes this decision historical is that the turn holding it was not run
    // here — the run it belonged to ended, and the session its confirmation id
    // was derived from is gone, so an Approve button would post into nothing.
    expect(screen.queryByTestId('msaidizi-composer-blocked')).toBeNull();
    expect(h.stream).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-10 · Removing the conversation you are in
 * ------------------------------------------------------------------------ */

const listPage = (data: MsaidiziConversationSummary[]) => ({
  data,
  meta: { page: 1, limit: 30, total: data.length },
});

/**
 * A conversation reaches this page two ways, and only one of them sets
 * `storedId`: the other is created by asking here, where the server's `session`
 * frame is the only place its id is ever written. Removing that one soft-deletes
 * the row and destroys its resume state, but the thread stays on screen holding
 * the dead id — and `scopeFor` excludes deleted rows, so every following turn is
 * answered `Conversation not found.` with nothing on screen pointing at "New
 * conversation". The rail refresh after each turn is what puts that row one
 * click from the user in the first place.
 */
describe('CHAT-10 · removing the conversation you are in clears it', () => {
  const LIVE: MsaidiziConversationSummary = {
    ...REOPENED,
    id: 'conv_live',
    agentSessionId: 'ms_live',
    title: 'Supplier totals',
  };

  it('starts a fresh thread instead of leaving one whose every next turn 404s', async () => {
    h.list
      // Mount: nothing yet. Then the row this run opened. Then, after the
      // removal, gone — which is the promise the confirm dialog makes.
      .mockResolvedValueOnce(listPage([]))
      .mockResolvedValueOnce(listPage([LIVE]))
      .mockResolvedValue(listPage([]));
    h.remove.mockResolvedValue({ id: 'conv_live', removed: true });
    h.stream
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'TZS 4,180,000 across three suppliers.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
          [],
          { conversationId: 'conv_live', agentSessionId: 'ms_live', sequence: 1 },
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Mkuza Traders.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');
    await screen.findByTestId('msaidizi-answer');

    await userEvent.click(await screen.findByLabelText(/remove supplier totals/i));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    // The thread goes with the conversation it belonged to.
    await screen.findByText(/ask msaidizi about your business/i);

    // And so does the id it was carrying: the next question opens a new
    // conversation rather than addressing a deleted one for the rest of the day.
    await ask('and which supplier is the biggest?');
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(bodies()[1].conversationId).toBeUndefined();
    expect(bodies()[1].sessionId).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-11 · The rail is refreshed when a turn settles
 * ------------------------------------------------------------------------ */

describe('CHAT-11 · a conversation appears in the rail without a page reload', () => {
  // Every run writes a conversation row, and a list fetched only on mount leaves
  // the thread the user is looking at missing from the list beside it until a
  // full reload — which reads as the history not being kept at all, under an
  // empty state promising it will appear there.
  it('lists the conversation the run just opened, once the turn has settled', async () => {
    h.list
      .mockResolvedValueOnce(listPage([]))
      .mockResolvedValue(listPage([{ ...REOPENED, id: 'conv_4', title: 'Yesterday’s totals' }]));
    h.stream.mockImplementation(
      scriptRun(
        [
          { type: 'text', text: 'TZS 4,180,000 across three suppliers.' },
          { type: 'done', reason: 'end_turn' },
        ],
        'end_turn',
      ),
    );

    render(<MsaidiziChat />);
    await screen.findByText(/no conversations yet/i);

    await ask('How much do we owe suppliers?');
    await screen.findByTestId('msaidizi-answer');

    expect(await conversationItem('Yesterday’s totals')).toBeInTheDocument();
    expect(h.list).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-12 · The session handle after a run that lost its result
 * ------------------------------------------------------------------------ */

describe('CHAT-12 · a run whose session id never arrived says so', () => {
  // The notice above this line says the run is still going on the server and
  // anything it changes will still be recorded. A line under it saying no id has
  // been minted yet destroys the only handle into the audit trail in the same
  // breath — and it is not even true: the run minted one, this page never
  // received it.
  it('does not claim an id is minted on the first question after one has run', async () => {
    h.stream.mockImplementation(
      scriptLostRun(
        [
          {
            type: 'tool_call',
            tool: 'SupplierInvoices_findAll',
            capabilityId: 'SupplierInvoicesController.findAll',
            tier: 'green',
            args: {},
          },
          { type: 'tool_result', tool: 'SupplierInvoices_findAll', ok: true, status: 200 },
        ],
        { kind: 'disconnected', message: 'The connection to Msaidizi was lost.' },
      ),
    );

    render(<MsaidiziChat />);
    await ask('How much do we owe suppliers?');

    await screen.findByTestId('msaidizi-terminal-notice');
    expect(await screen.findByText(/session id did not reach this page/i)).toBeInTheDocument();
    expect(screen.queryByText(/no session id yet/i)).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-13 · Being asked a second time about the same action
 * ------------------------------------------------------------------------ *
 *
 * The sequence: the user approves one red action, the resumed turn CARRIES IT
 * OUT, and the same action is proposed again in that same turn. It is reachable
 * whenever the model re-issues a call — a retry after a timeout, a second
 * posting it genuinely intends — and it is what a run does when an approval that
 * has already been used is not honoured a second time.
 *
 * Drawn naively the screen is a trap. The step row says "Carried out post
 * journal entry" with the figures, and directly beneath it the same figures
 * appear again inside a live decision box that used to open "nothing below has
 * happened". A user reading that concludes either that the page has drawn one
 * action twice or that the gate did not register their click, and clears it the
 * only way the screen offers — by approving again. The entry posts twice.
 *
 * So this drives the whole page, real reducer and real thread, through that
 * sequence and asserts the screen tells the true story: the first posting stands
 * as a carried-out step, the second is named as a repeat of it, and Approve is
 * live because approving IS available — the point is that the user is told what
 * they would be approving, not that they are stopped.
 */

const RENT_ARGS = {
  body: { memo: 'Rent Aug', lines: [{ account: '6000', debit: 50_000 }] },
};

/**
 * One proposal for the August rent, with the grant the server issued for it.
 *
 * A function rather than a constant because a grant is minted per PROPOSAL: the
 * same action proposed twice gets two grants, and a fixture that reused one
 * would quietly assert the opposite of the model this page is built on — and
 * would let a client that re-sent a spent id pass.
 */
const rentProposal = (grantId: string): MsaidiziEvent => ({
  type: 'confirmation_required',
  grantId,
  confirmationId: 'cnf_JournalEntries_post_961882d1',
  tool: 'JournalEntries_post',
  capabilityId: 'JournalEntriesController.post',
  description: 'Post journal entry — rent for August, TZS 50,000',
  args: RENT_ARGS,
});

const RENT_PROPOSAL = rentProposal('grt_rent_first_7b2e');
const RENT_PROPOSAL_AGAIN = rentProposal('grt_rent_second_11d4');

describe('CHAT-13 · a second ask about an action already carried out', () => {
  it('names the repeat instead of drawing what looks like a stuck gate', async () => {
    h.stream
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'I can post the August rent journal. Confirm and I will.' },
            RENT_PROPOSAL,
            { type: 'done', reason: 'awaiting_confirmation' },
          ],
          'awaiting_confirmation',
        ),
      )
      // The resumed turn: the approval is spent on the first call, which runs,
      // and the model asks for the same posting again inside the same turn.
      .mockImplementationOnce(
        scriptRun(
          [
            {
              type: 'tool_call',
              tool: 'JournalEntries_post',
              capabilityId: 'JournalEntriesController.post',
              tier: 'red',
              args: RENT_ARGS,
            },
            { type: 'tool_result', tool: 'JournalEntries_post', ok: true, status: 201 },
            RENT_PROPOSAL_AGAIN,
            { type: 'done', reason: 'awaiting_confirmation' },
          ],
          'awaiting_confirmation',
        ),
      );

    render(<MsaidiziChat />);
    await ask('post the August rent journal');

    const first = await screen.findByTestId('msaidizi-confirmation-gate');
    // Nothing has been attempted yet, so nothing is called a repeat.
    expect(within(first).queryByTestId('msaidizi-gate-repeat')).toBeNull();
    await userEvent.click(within(first).getByRole('checkbox'));
    await userEvent.click(screen.getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(bodies()[1].confirmed).toEqual(['grt_rent_first_7b2e']);

    // The posting that ran is on screen, in the past tense, with its figures.
    const step = await screen.findByTestId('msaidizi-step');
    expect(step).toHaveTextContent(/^Carried out/);
    expect(step).toHaveTextContent('50000');

    // And the second ask is a decision box that says what it is.
    const second = await waitFor(() => {
      const gate = screen.getByTestId('msaidizi-confirmation-gate');
      expect(within(gate).getByTestId('msaidizi-gate-repeat')).toBeInTheDocument();
      return gate;
    });
    expect(within(second).getByTestId('msaidizi-gate-repeat')).toHaveTextContent(
      /repeats an action Msaidizi already attempted in this conversation/i,
    );
    expect(within(second).getByTestId('msaidizi-confirmation-row')).toHaveAttribute(
      'data-repeats',
      'carried-out',
    );
    expect(within(second).getByTestId('msaidizi-confirmation-row-repeat')).toHaveTextContent(
      /approving makes it happen a second time/i,
    );
    // The sentence that would have been false about it is gone.
    expect(second.textContent ?? '').not.toMatch(/nothing below has happened/i);
    // One decision box, and one row inside it. The first turn's proposal is
    // still in the transcript above as a record — and it is NOT marked as a
    // repeat, because nothing had been attempted when it was made. A lookup
    // applied to the whole thread without regard to order would mark it, and
    // turn the ordinary propose-approve-run history into a page claiming the
    // user was asked twice from the start.
    expect(screen.getAllByTestId('msaidizi-confirmation-row')).toHaveLength(1);
    const records = screen.getAllByTestId('msaidizi-confirmation-record');
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveAttribute('data-repeats');
  });

  it('still lets the user say yes a second time, having said which yes it is', async () => {
    h.stream
      .mockImplementationOnce(
        scriptRun(
          [RENT_PROPOSAL, { type: 'done', reason: 'awaiting_confirmation' }],
          'awaiting_confirmation',
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            {
              type: 'tool_call',
              tool: 'JournalEntries_post',
              capabilityId: 'JournalEntriesController.post',
              tier: 'red',
              args: RENT_ARGS,
            },
            { type: 'tool_result', tool: 'JournalEntries_post', ok: true, status: 201 },
            RENT_PROPOSAL_AGAIN,
            { type: 'done', reason: 'awaiting_confirmation' },
          ],
          'awaiting_confirmation',
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Both entries are posted.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('post the August rent journal twice');

    await userEvent.click(
      within(await screen.findByTestId('msaidizi-confirmation-gate')).getByRole('checkbox'),
    );
    await userEvent.click(screen.getByTestId('msaidizi-approve'));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));

    // The gate is a working gate, not a dead one: a second posting is sometimes
    // exactly what was asked for, and this page's job is to say which posting is
    // being approved rather than to decide for the user.
    await waitFor(() => expect(screen.getByTestId('msaidizi-gate-repeat')).toBeInTheDocument());
    const approve = screen.getByTestId('msaidizi-approve');
    expect(approve).toBeDisabled();
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(approve).toBeEnabled();
    await userEvent.click(approve);

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));
    // The SECOND proposal's own grant, on exactly one request. Re-sending the
    // first grant here would be the durable half of the old defect in miniature:
    // one approval, two executions, a request apart. It is a different id
    // because the server minted a different one, and this page has no way to
    // produce either.
    expect(bodies()[2].confirmed).toEqual(['grt_rent_second_11d4']);
    expect(JSON.stringify(bodies()[2])).not.toContain('grt_rent_first_7b2e');
    expect(await screen.findByText('Both entries are posted.')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAT-14 · ══ THE GRANT ══ the client sends what the server issued
 * ------------------------------------------------------------------------ *
 *
 * `confirmed` used to name a DERIVED id — session, tool and arguments, hashed —
 * which this page could have produced for itself out of values it already holds.
 * An id anyone can produce is a pre-authorisation channel rather than a receipt,
 * and because it was deterministic the same id re-sent on a later request bought
 * another execution.
 *
 * It now names a GRANT: a nonce the server minted when it recorded the proposal,
 * spent once, atomically, at dispatch. The client's whole share of that is to
 * READ it and hand it back, so what these tests pin is exactly that — and the
 * shape they pin it in is the one no fixture in this file had: the SAME action,
 * proposed identically, across two separate REQUESTS.
 *
 * A refused grant is not an error. The action re-proposes with a new grant, and
 * the screen has to make that legible: the approval was not used, nothing ran,
 * this is a fresh decision. A user who reads that screen as a stuck gate clears
 * it the only way it offers — by approving again.
 */

const DELETE_ARGS = { body: { id: '41', reason: 'duplicate of 40' } };

const deleteProposal = (grantId: string): MsaidiziEvent => ({
  type: 'confirmation_required',
  grantId,
  // Deliberately the SAME derived id on both proposals, because it is derived
  // from the session, the tool and the arguments and none of those changed. If
  // anything in this page still reached for it, the two turns would be
  // indistinguishable and this suite would pass while the defect stood.
  confirmationId: 'cnf_Invoices_remove_deadbeef',
  tool: 'Invoices_remove',
  capabilityId: 'InvoicesController.remove',
  description: 'Delete invoice with id 41',
  args: DELETE_ARGS,
});

const suspendedOn = (...events: MsaidiziEvent[]): MsaidiziEvent[] => [
  ...events,
  { type: 'done', reason: 'awaiting_confirmation' },
];

describe('CHAT-14 · an approval names the grant the server issued, and only that', () => {
  it('sends the FRESH grant when a refused one comes back as a new proposal', async () => {
    h.stream
      .mockImplementationOnce(
        scriptRun(
          suspendedOn(
            { type: 'text', text: 'I can delete invoice 41. Confirm and I will.' },
            deleteProposal('grt_issued_first_0a1b'),
          ),
          'awaiting_confirmation',
        ),
      )
      // The resumed turn. The server would not spend the grant — used, lapsed,
      // or a ledger it could not reach; the client cannot tell which and must
      // not guess — so NOTHING was dispatched and the action was proposed again
      // under a new grant.
      .mockImplementationOnce(
        scriptRun(suspendedOn(deleteProposal('grt_issued_second_9f8e')), 'awaiting_confirmation'),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            {
              type: 'tool_call',
              tool: 'Invoices_remove',
              capabilityId: 'InvoicesController.remove',
              tier: 'red',
              args: DELETE_ARGS,
            },
            { type: 'tool_result', tool: 'Invoices_remove', ok: true, status: 200 },
            { type: 'text', text: 'Deleted.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    const first = await screen.findByTestId('msaidizi-confirmation-gate');
    await userEvent.click(within(first).getByRole('checkbox'));
    await userEvent.click(within(first).getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(bodies()[1].confirmed).toEqual(['grt_issued_first_0a1b']);

    // The second gate. It says what happened rather than redrawing the same
    // question in silence.
    const second = await waitFor(() => {
      const gate = screen.getByTestId('msaidizi-confirmation-gate');
      expect(within(gate).getByTestId('msaidizi-gate-unhonoured')).toBeInTheDocument();
      return gate;
    });
    expect(within(second).getByTestId('msaidizi-gate-unhonoured')).toHaveTextContent(
      /did not use that approval/i,
    );
    // And it does NOT claim the action was carried out. Nothing was dispatched;
    // the transcript has no step row for it at all.
    expect(screen.queryByTestId('msaidizi-step')).toBeNull();
    expect(within(second).queryByTestId('msaidizi-gate-repeat')).toBeNull();

    await userEvent.click(within(second).getByRole('checkbox'));
    await userEvent.click(within(second).getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));
    // THE DURABLE HALF, in the shape that hid it: the second request is a
    // separate HTTP request carrying an identical action, and the id on it is
    // the one the SERVER issued for the second proposal. Re-sending the first —
    // which a client parking `confirmed`, or recomputing it, would do — is the
    // "one approval, two executions, a request apart" that the ledger exists to
    // refuse and that this page must never attempt.
    expect(bodies()[2].confirmed).toEqual(['grt_issued_second_9f8e']);
    const wire = JSON.stringify(bodies()[2]);
    expect(wire).not.toContain('grt_issued_first_0a1b');
    // Nor the derived id, which is identical on both proposals and is therefore
    // the one value that would make the two requests look interchangeable.
    expect(wire).not.toContain('cnf_Invoices_remove_deadbeef');

    expect(await screen.findByText('Deleted.')).toBeInTheDocument();
  });

  it('puts both grants on one request when two distinct proposals are approved together', async () => {
    const payrollProposal: MsaidiziEvent = {
      type: 'confirmation_required',
      grantId: 'grt_payroll_5c2d',
      confirmationId: 'cnf_JournalEntries_post_payroll',
      tool: 'JournalEntries_post',
      capabilityId: 'JournalEntriesController.post',
      description: 'Post journal entry — payroll, TZS 9,000,000',
      args: { body: { memo: 'Payroll Aug', lines: [{ account: '7000', debit: 9_000_000 }] } },
    };

    h.stream
      .mockImplementationOnce(
        scriptRun(
          suspendedOn(deleteProposal('grt_issued_first_0a1b'), payrollProposal),
          'awaiting_confirmation',
        ),
      )
      .mockImplementationOnce(scriptRun([{ type: 'done', reason: 'end_turn' }], 'end_turn'));

    render(<MsaidiziChat />);
    await ask('delete invoice 41 and post the payroll');

    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    for (const box of within(gate).getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(within(gate).getByTestId('msaidizi-approve'));

    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    // Two grants, in row order, on one request. Each authorises its own action:
    // one array is not one approval, and the message beside it names both.
    expect(bodies()[1].confirmed).toEqual(['grt_issued_first_0a1b', 'grt_payroll_5c2d']);
    expect(bodies()[1].message).toContain('Delete invoice with id 41');
    expect(bodies()[1].message).toContain('payroll');
  });

  it('never parks a grant in state, so no later turn can carry it', async () => {
    h.stream
      .mockImplementationOnce(
        scriptRun(suspendedOn(deleteProposal('grt_issued_first_0a1b')), 'awaiting_confirmation'),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Deleted.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      )
      .mockImplementationOnce(
        scriptRun(
          [
            { type: 'text', text: 'Nothing else.' },
            { type: 'done', reason: 'end_turn' },
          ],
          'end_turn',
        ),
      );

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    await userEvent.click(within(gate).getByRole('checkbox'));
    await userEvent.click(within(gate).getByTestId('msaidizi-approve'));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));

    await screen.findByText('Deleted.');
    await ask('anything else outstanding?');
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(3));

    // The one-shot, in grant form. The ledger would now refuse a second send —
    // and that is not why this holds: the rule is about what this page may claim
    // the user said, and it would hold against a server with no ledger at all.
    expect(bodies()[2].confirmed).toBeUndefined();
    expect(JSON.stringify(bodies()[2])).not.toContain('grt_issued_first_0a1b');
  });

  // The last resort, and the one that must not be papered over. A proposal
  // without a grant cannot be approved, and this page does not fall back to the
  // derived id, does not invent one, and does not start a turn that says yes to
  // something it has no id for.
  it('starts no turn at all for a proposal that arrived without a grant', async () => {
    const ungranted: MsaidiziEvent = {
      type: 'confirmation_required',
      confirmationId: 'cnf_Invoices_remove_deadbeef',
      tool: 'Invoices_remove',
      capabilityId: 'InvoicesController.remove',
      description: 'Delete invoice with id 41',
      args: DELETE_ARGS,
    };

    h.stream.mockImplementationOnce(scriptRun(suspendedOn(ungranted), 'awaiting_confirmation'));

    render(<MsaidiziChat />);
    await ask('delete invoice 41');

    const gate = await screen.findByTestId('msaidizi-confirmation-gate');
    expect(within(gate).getByTestId('msaidizi-gate-ungranted')).toHaveTextContent(
      /cannot be approved from here/i,
    );
    expect(within(gate).getByRole('checkbox')).toBeDisabled();
    expect(within(gate).getByTestId('msaidizi-approve')).toBeDisabled();

    // Declining still works, and is the way out of this screen.
    expect(within(gate).getByTestId('msaidizi-decline')).toBeEnabled();
    expect(h.stream).toHaveBeenCalledTimes(1);
  });
});
