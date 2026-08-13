import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateMobilePosLiteStockCountDto,
  MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES,
} from './mobile-pos-lite-stock-count.dto';

const KEY = 'offline-count-key-000001';

function body(lineCount: number) {
  return {
    idempotencyKey: KEY,
    lines: Array.from({ length: lineCount }, (_, index) => ({
      productId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
      countedQuantity: index,
    })),
  };
}

async function errorsFor(lineCount: number) {
  const dto = plainToInstance(CreateMobilePosLiteStockCountDto, body(lineCount), {
    enableImplicitConversion: true,
  });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateMobilePosLiteStockCountDto line cap', () => {
  it('accepts a full closing count at the cap', async () => {
    expect(await errorsFor(MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES)).toHaveLength(0);
  });

  it('rejects one line over the cap with copy the phone can map, not class-validator English', async () => {
    // class-validator's default ("lines must contain no more than N elements")
    // matches no row in pos-errors.ts, so an over-long sheet reached the manager
    // as the generic "Haikukubaliwa — mwite msimamizi" card: no cap named, no
    // recovery named, and every retry identical. This sentence is the contract
    // the phone's error map is written against.
    const errors = await errorsFor(MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES + 1);

    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toEqual([
      'A stock count can carry at most 500 products — send the rest as a second count.',
    ]);
  });
});
