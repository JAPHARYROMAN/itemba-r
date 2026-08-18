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
 *         has silently granted standing permission for that action for the rest
 *         of the run — the server checks it as a plain set against every red
 *         proposal and keeps no pending state of its own.
 * CHAT-4  `history` is echoed back BY REFERENCE. Not mapped, not cloned, not
 *         re-typed. The provider's content blocks must survive the round trip
 *         untouched, and normalising them broke multi-turn completely once.
 * CHAT-5  A stored conversation is readable and not continuable, and the
 *         composer says why instead of failing later.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MsaidiziStreamOutcome } from '@/lib/msaidizi-stream';
import type {
  MsaidiziAskRequest,
  MsaidiziCapabilities,
  MsaidiziConversationDetail,
  MsaidiziEvent,
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

/** One scripted run: emit these events, then settle with this reason. */
function scriptRun(events: MsaidiziEvent[], reason: string, messages: ModelMessage[] = []) {
  return async (
    _request: MsaidiziAskRequest,
    handlers: { onEvent?: (e: MsaidiziEvent) => void; onResult?: (r: unknown) => void } = {},
  ): Promise<MsaidiziStreamOutcome> => {
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
      session: null,
      malformedFrames: 0,
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
    expect(bodies()[1].confirmed).toEqual(['cnf_Invoices_remove_1a2b3c']);
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
