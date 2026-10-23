import { ArgumentsHost, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EphemeralSecretFingerprintRegistry, PersistenceSecretGuard } from '../services';
import { PrismaExceptionFilter } from './prisma-exception.filter';

const PAYMENT_PATH = '/api/v1/receivables/rec-1/record-payment';

function responseHost(url = PAYMENT_PATH) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'PATCH', url }),
    }),
  } as unknown as ArgumentsHost;
  return { response, host };
}

function validationError(message: string) {
  return new Prisma.PrismaClientValidationError(message, { clientVersion: 'test' });
}

function knownError(code: string, message = 'Internal database detail') {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

describe('PrismaExceptionFilter', () => {
  let registry: EphemeralSecretFingerprintRegistry;
  let filter: PrismaExceptionFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    registry = new EphemeralSecretFingerprintRegistry();
    filter = new PrismaExceptionFilter(new PersistenceSecretGuard(registry));
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the validation response generic and logs the failing invocation and hint', () => {
    const { response, host } = responseHost();
    const detail =
      'Invalid tx.journalEntry.findFirst() invocation:\nUnknown argument `companyId_journalNumber`.';

    filter.catch(validationError(detail), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      statusCode: 400,
      error: 'Database Error',
      message: 'Invalid data provided to the database layer',
      path: PAYMENT_PATH,
      method: 'PATCH',
      timestamp: expect.any(String),
    });
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('companyId_journalNumber');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      `[PATCH] ${PAYMENT_PATH} → Prisma validation error: ${detail}`,
    );
  });

  it('redacts labelled and declared secrets before validation details reach the logger', () => {
    const declaredSecret = 'private-passphrase';
    const password = 'invoice-password';
    const token = 'test-access-token';
    const encodedSecret = Buffer.from(declaredSecret).toString('base64');
    registry.register(declaredSecret);
    const { response, host } = responseHost();
    const detail = [
      'Invalid tx.receivable.update() invocation:',
      `data: { password: "${password}", accessToken: "${token}" }`,
      `note: "prefix-${declaredSecret}-suffix", reference: "${encodedSecret}"`,
      'Unknown argument `password`.',
    ].join('\n');

    filter.catch(validationError(detail), host);

    const logged = JSON.stringify(errorSpy.mock.calls);
    const body = JSON.stringify(response.json.mock.calls);
    for (const secret of [declaredSecret, password, token, encodedSecret]) {
      expect(logged).not.toContain(secret);
      expect(body).not.toContain(secret);
    }
    expect(logged).toContain('tx.receivable.update()');
    expect(logged).toContain('Unknown argument');
    expect(logged).toContain('[REDACTED SECRET]');
  });

  it('sanitizes request context included in validation logs', () => {
    const { host } = responseHost(`${PAYMENT_PATH}?access_token=context-token`);

    filter.catch(validationError('Unknown argument `branchId`.'), host);

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('context-token');
    expect(logged).toContain(PAYMENT_PATH);
    expect(logged).toContain('Unknown argument');
  });

  it.each([
    ['P2002', 409, 'Duplicate value violates a unique constraint'],
    ['P2025', 404, 'Record not found'],
    ['P2003', 400, 'Invalid reference (foreign key constraint failed)'],
  ])('preserves the %s response', (code, status, message) => {
    const { response, host } = responseHost();

    filter.catch(knownError(code), host);

    expect(response.status).toHaveBeenCalledWith(status);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: status, message, error: 'Database Error' }),
    );
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('Internal database detail');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('preserves unknown known-error responses and sanitizes their diagnostic logs', () => {
    const { response, host } = responseHost();
    const exception = knownError('P2028', 'Transaction failed password=private-db-password');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Database error' }),
    );
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain('P2028');
    expect(logged).not.toContain('private-db-password');
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('Transaction failed');
  });
});
