import { ArgumentsHost, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

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
