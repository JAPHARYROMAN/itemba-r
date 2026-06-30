import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { QueryProductCategoryDto } from './dto/query-product-category.dto';

// Exercise the DTO through the SAME ValidationPipe config as main.ts so the test
// reflects production behavior (enableImplicitConversion would otherwise coerce
// any non-empty string to boolean `true` before @Transform runs).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const run = (query: Record<string, unknown>) =>
  pipe.transform(query, {
    type: 'query',
    metatype: QueryProductCategoryDto,
  } as never) as Promise<QueryProductCategoryDto>;

describe('QueryProductCategoryDto isActive coercion', () => {
  it('coerces "false" to boolean false (not true)', async () => {
    expect((await run({ isActive: 'false' })).isActive).toBe(false);
  });

  it('coerces "true" to boolean true', async () => {
    expect((await run({ isActive: 'true' })).isActive).toBe(true);
  });

  it('leaves isActive undefined when omitted', async () => {
    expect((await run({})).isActive).toBeUndefined();
  });
});
