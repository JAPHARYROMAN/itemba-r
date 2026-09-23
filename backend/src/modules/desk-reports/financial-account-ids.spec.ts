import { validate } from 'class-validator';
import { ConnectionDto, CashPostDto } from './cash-connections.controller';
import { PostSourceDto } from './desk-posting.controller';

describe('Existing financial account identifiers', () => {
  it('accepts migrated bank and chart identifiers as opaque, bounded strings', async () => {
    const connection = Object.assign(new ConnectionDto(), {
      cashAccountId: 'bank-cash-daaeb455-36ee-42da-9189-a1ed02ddf66d',
      ledgerAccountId: '26667e0d1ed5aa15c512bc815fd754b7',
    });
    expect(await validate(connection)).toEqual([]);
    const cashPost = Object.assign(new CashPostDto(), {
      fingerprint: 'a'.repeat(64),
      offsetAccountId: connection.ledgerAccountId,
    });
    expect(await validate(cashPost)).toEqual([]);
    const invoicePost = Object.assign(new PostSourceDto(), {
      fingerprint: cashPost.fingerprint,
      debitAccountId: connection.ledgerAccountId,
      creditAccountId: 'valid-legacy-ledger-id',
    });
    expect(await validate(invoicePost)).toEqual([]);
  });
  it('rejects empty, non-string and oversized identifiers', async () => {
    for (const bad of ['', 123, 'x'.repeat(129)]) {
      const dto = Object.assign(new ConnectionDto(), {
        cashAccountId: bad,
        ledgerAccountId: 'valid-id',
      });
      expect((await validate(dto)).some((error) => error.property === 'cashAccountId')).toBe(true);
    }
  });
});
