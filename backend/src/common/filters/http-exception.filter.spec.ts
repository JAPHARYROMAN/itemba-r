import { ArgumentsHost, ConflictException, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

/** A host whose `json` call is the body the browser would receive. */
function hostFor(response: { status: jest.Mock; json: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/msaidizi/ask/stream' }),
    }),
  } as unknown as ArgumentsHost;
}

function bodyFor(exception: unknown): Record<string, unknown> {
  const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  new HttpExceptionFilter().catch(exception, hostFor(response));
  warnSpy.mockRestore();
  return response.json.mock.calls[0][0] as Record<string, unknown>;
}

/**
 * This filter rebuilds the response body field by field, so a field it does not
 * name never reaches the browser. That made a `code` added at a throw site a
 * silent no-op — and the client branch it was added for (two 409s that are
 * opposite answers) would have gone on reading the server's English forever
 * while every test upstream of here passed.
 */
describe('HttpExceptionFilter discriminator passthrough', () => {
  it('carries a string code from the thrower onto the body', () => {
    const body = bodyFor(
      new ConflictException({
        message: 'The last thing you asked has not finished being saved.',
        error: 'Conflict',
        code: 'unfinished_turn',
      }),
    );
    expect(body.code).toBe('unfinished_turn');
    // The sentence is still what the user reads; the code only decides a branch.
    expect(body.message).toBe('The last thing you asked has not finished being saved.');
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
  });

  it('omits the key entirely when nothing supplied one', () => {
    const body = bodyFor(new ConflictException('This conversation continued in another window.'));
    expect('code' in body).toBe(false);
    expect(body.message).toBe('This conversation continued in another window.');
  });

  it('does not forward a non-string code', () => {
    const body = bodyFor(new ConflictException({ message: 'nope', code: { nested: true } }));
    expect('code' in body).toBe(false);
  });
});

describe('HttpExceptionFilter redaction', () => {
  it('scrubs sensitive values from 5xx log context', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const filter = new HttpExceptionFilter();
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          url: '/boom?token=abc123',
        }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error('failure password=secret token=abc123'), host);

    expect(errorSpy).toHaveBeenCalled();
    const [message, stack] = errorSpy.mock.calls[0];
    expect(message).not.toContain('abc123');
    expect(stack).not.toContain('secret');
    errorSpy.mockRestore();
  });
});
