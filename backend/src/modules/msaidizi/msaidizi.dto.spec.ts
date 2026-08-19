/**
 * The DTO round-trip, exercised through the real ValidationPipe.
 *
 * msaidizi.isolation.spec.ts calls MsaidiziService.run() directly, which is the
 * right place to prove the envelope but skips the HTTP boundary entirely. That
 * gap hid a total failure of multi-turn conversation: `history` was typed as the
 * `ModelMessage` interface, interfaces carry no runtime metadata, and the global
 * pipe runs `whitelist: true` — so every prior turn arrived as `{}` and the model
 * request died with "messages.0: Input does not match the expected shape".
 *
 * Nothing about that is visible from the service's side. It needs the pipe.
 */

import { ValidationPipe } from '@nestjs/common';
import { GRANT_ID, MAX_CONFIRMED_PER_TURN, mintGrantId } from './dto/approval-grants';
import { AskDto } from './msaidizi.controller';
import { RunProcedureDto } from './procedures.controller';

// Mirrors the configuration in main.ts. If that changes, change this with it —
// the point of these tests is that the pipe behaves the way production's does.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const meta = { type: 'body' as const, metatype: AskDto };

describe('AskDto through the production ValidationPipe', () => {
  it('keeps role and content on every history turn', async () => {
    const result = (await pipe.transform(
      {
        message: 'What did I just say?',
        history: [
          { role: 'user', content: 'My favourite colour is blue.' },
          { role: 'assistant', content: 'Noted.' },
        ],
      },
      meta,
    )) as AskDto;

    expect(result.history).toHaveLength(2);
    // The regression: these were being stripped to {}.
    expect(result.history?.[0]).toEqual({ role: 'user', content: 'My favourite colour is blue.' });
    expect(result.history?.[1].role).toBe('assistant');
  });

  it('preserves assistant content blocks byte-for-byte, including provider-added fields', async () => {
    // `caller` is added by the API and must survive the round trip untouched —
    // a nested @Type() on content would strip exactly this kind of field.
    const assistantContent = [
      { type: 'text', text: "I'll look that up." },
      {
        type: 'tool_use',
        id: 'toolu_01Dv1X36KDhXB7gWVjDZmyyu',
        name: 'Customers_findAll',
        caller: { type: 'direct' },
        input: { search: 'Test Customer' },
      },
    ];

    const result = (await pipe.transform(
      {
        message: 'and now?',
        history: [
          { role: 'user', content: 'find it' },
          { role: 'assistant', content: assistantContent },
        ],
      },
      meta,
    )) as AskDto;

    expect(result.history?.[1].content).toEqual(assistantContent);
  });

  it('preserves tool_result blocks on user turns', async () => {
    const toolResult = [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01abc',
        is_error: false,
        content: '<tool_result tool="Customers_findAll">…</tool_result>',
      },
    ];

    const result = (await pipe.transform(
      { message: 'continue', history: [{ role: 'user', content: toolResult }] },
      meta,
    )) as AskDto;

    expect(result.history?.[0].content).toEqual(toolResult);
  });

  it('still rejects a malformed role', async () => {
    await expect(
      pipe.transform({ message: 'x', history: [{ role: 'system', content: 'sneaky' }] }, meta),
    ).rejects.toThrow();
  });

  it('still rejects a turn with no content', async () => {
    await expect(
      pipe.transform({ message: 'x', history: [{ role: 'user' }] }, meta),
    ).rejects.toThrow();
  });

  it('carries grant ids through, which the red-tier flow depends on', async () => {
    const grant = mintGrantId();

    const result = (await pipe.transform({ message: 'yes', confirmed: [grant] }, meta)) as AskDto;

    expect(result.confirmed).toEqual([grant]);
  });

  it('accepts a request with no history at all', async () => {
    const result = (await pipe.transform({ message: 'hello' }, meta)) as AskDto;
    expect(result.history).toBeUndefined();
    expect(result.message).toBe('hello');
  });
});

/**
 * `confirmed` used to be `@IsString({ each: true })` — any string at all — and
 * that was the honest validator for what the field then held. Approvals were
 * `confirmationIdFor(sessionId, toolName, args)`: a hex digest with no prefix and
 * no fixed relationship to anything a validator could name, computed by the
 * server and equally computable by the caller. There was nothing to pin.
 *
 * A grant id is different in kind. It is a nonce THIS SERVER minted and handed
 * out on a `confirmation_required` event, so its shape is a fact about the
 * server rather than about the action, and the field can say so.
 *
 * What that buys, and what it does not:
 *
 *   - it buys the mistake being named. A client that sends a session id, a
 *     confirmation id, or a leftover derived id gets a 400 naming `confirmed`
 *     instead of a 200 and a run that suspends on an action it thought it had
 *     approved — which, from the seat, is the server ignoring the user;
 *   - it does not buy authorisation, and the last test here keeps that written
 *     down. A well-formed grant id a client invented passes this pipe and
 *     matches no row in the ledger, so it authorises nothing. The pattern keeps
 *     malformed input out of the query; the query decides.
 *
 * Both surfaces are driven, because `RunProcedureDto` is the other door into the
 * same gate and a procedure approval that a copy of this rule had drifted on
 * would be discovered by a user rather than by CI.
 */
describe('the approvals a client may send are pinned to the shape this server issues', () => {
  const surfaces: [string, new () => object, Record<string, unknown>][] = [
    ['AskDto', AskDto, { message: 'yes, do it' }],
    ['RunProcedureDto', RunProcedureDto, {}],
  ];

  describe.each(surfaces)('%s', (_name, cls, base) => {
    const dtoMeta = { type: 'body' as const, metatype: cls };
    const through = (confirmed: unknown) => pipe.transform({ ...base, confirmed }, dtoMeta);

    it('accepts what mintGrantId() actually produces', async () => {
      const grants = [mintGrantId(), mintGrantId()];

      const result = (await through(grants)) as { confirmed?: string[] };

      expect(result.confirmed).toEqual(grants);
    });

    it('rejects the derived confirmation id this field used to carry', async () => {
      // The exact shape `confirmationIdFor` produces — 64 lowercase hex — and
      // the shape a client that kept the old contract would still be sending.
      // It has to be refused rather than quietly ignored: an accepted-and-unused
      // id is a run that suspends again on an action the user just approved.
      await expect(through(['a'.repeat(64)])).rejects.toThrow();
    });

    it('rejects a session id sent into the approvals field', async () => {
      // The two ids travel on the same request and are one field apart. Their
      // alphabets are mutually exclusive precisely so this is a 400 naming the
      // field rather than a silently unspendable approval.
      await expect(through([`ms_${'0123456789abcdef'.repeat(2)}`])).rejects.toThrow();
    });

    it('rejects a uuid that kept its dashes, and one in the wrong case', async () => {
      await expect(through(['grt_0123456789ab-cdef-0123456789abcdef'])).rejects.toThrow();
      await expect(through([`grt_${'0123456789ABCDEF'.repeat(2)}`])).rejects.toThrow();
    });

    it('rejects a non-string element hidden in an otherwise valid array', async () => {
      await expect(through([mintGrantId(), 42])).rejects.toThrow();
    });

    it('rejects an array past the per-request cap', async () => {
      const overflowing = Array.from({ length: MAX_CONFIRMED_PER_TURN + 1 }, () => mintGrantId());

      await expect(through(overflowing)).rejects.toThrow();
      // The boundary itself still passes: a cap a real approval can hit is a cap
      // that fails a user rather than an attacker.
      await expect(through(overflowing.slice(0, MAX_CONFIRMED_PER_TURN))).resolves.toBeDefined();
    });

    it('still lets a caller send none at all, which is every non-approval turn', async () => {
      const result = (await pipe.transform({ ...base }, dtoMeta)) as { confirmed?: string[] };

      expect(result.confirmed).toBeUndefined();
    });

    it('accepts a conforming id a client invented, because shape is all this is', async () => {
      // Not a defect being tolerated: it is the boundary of what a regex on a
      // string can decide, recorded here so no comment upstream can promote
      // "could have been issued" into "was issued". What stops this one is the
      // ledger — it names no row, so it spends nothing and the action is
      // proposed again.
      const invented = `grt_${'0123456789abcdef'.repeat(2)}`;

      expect(invented).toMatch(GRANT_ID);
      await expect(through([invented])).resolves.toBeDefined();
    });
  });

  it('mints ids its own validator accepts', async () => {
    // The mint and the pattern live in one file for this reason. A mint that
    // drifted would issue grants the very next request could not send back, and
    // the failure would look like an approval button that does nothing.
    for (let i = 0; i < 200; i += 1) {
      expect(mintGrantId()).toMatch(GRANT_ID);
    }
  });
});
