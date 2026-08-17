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
import { AskDto } from './msaidizi.controller';

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

  it('carries confirmation ids through, which the red-tier flow depends on', async () => {
    const result = (await pipe.transform(
      { message: 'yes', confirmed: ['cnf_Customers_remove_abc123'] },
      meta,
    )) as AskDto;

    expect(result.confirmed).toEqual(['cnf_Customers_remove_abc123']);
  });

  it('accepts a request with no history at all', async () => {
    const result = (await pipe.transform({ message: 'hello' }, meta)) as AskDto;
    expect(result.history).toBeUndefined();
    expect(result.message).toBe('hello');
  });
});
