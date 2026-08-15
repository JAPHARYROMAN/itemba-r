import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { DeliveryNotesService } from './delivery-notes.service';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { QueryDeliveryNoteDto } from './dto/query-delivery-note.dto';

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dn-1',
    companyId: 'company-1',
    deliveryNoteNumber: 'DN-2026-00001',
    status: 'DRAFT',
    counterSaleOrderId: null,
    ...overrides,
  };
}

function makeService() {
  const created: any[] = [];
  const prisma: any = {
    deliveryNote: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        created.push(data);
        return Promise.resolve(noteRow(data));
      }),
      findFirst: jest.fn().mockResolvedValue(noteRow()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(noteRow()),
    },
    deliveryNoteLine: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
  };
  const auditLogs: any = { log: jest.fn().mockResolvedValue(undefined) };
  const codes: any = { next: jest.fn().mockResolvedValue('DN-2026-00001') };

  return {
    service: new DeliveryNotesService(prisma, auditLogs, codes),
    prisma,
    auditLogs,
    codes,
    created,
  };
}

function scopedUser() {
  return {
    id: 'user-1',
    email: 'office@example.com',
    roles: [],
    permissions: [],
    companyId: 'company-1',
    companyAccess: [{ companyId: 'company-1', accessLevel: 'WRITE' }],
  } as any;
}

function createDto(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'company-1',
    salesOrderId: 'so-1',
    deliveryDate: '2026-08-15T09:14:00.000Z',
    lines: [{ productId: 'product-1', quantity: 2, unitId: 'unit-1' }],
    ...overrides,
  } as any;
}

describe('DeliveryNotesService counter-sale discriminator', () => {
  // CD-17
  it('create() writes NULL when no context is supplied', async () => {
    const { service, created } = makeService();

    await service.create(createDto(), 'user-1');

    expect(created).toHaveLength(1);
    expect(created[0].counterSaleOrderId).toBeNull();
  });

  // CD-17
  it('create() writes the sales-order id when the POS supplies the context', async () => {
    const { service, created } = makeService();

    await service.create(createDto(), 'user-1', { counterSaleOrderId: 'so-1' });

    expect(created[0].counterSaleOrderId).toBe('so-1');
  });

  // CD-17: the discriminator is SERVER-DERIVED. No request body may set it.
  it('CreateDeliveryNoteDto has no counterSaleOrderId member, so no client can claim one', async () => {
    // The global pipe runs whitelist + forbidNonWhitelisted, so a body carrying
    // the key is rejected outright rather than quietly stripped. Either way the
    // value can never reach the column from outside the server.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata = { type: 'body' as const, metatype: CreateDeliveryNoteDto };

    const rejection = await pipe
      .transform(createDto({ counterSaleOrderId: 'so-1' }), metadata)
      .then(
        () => null,
        (error: any) => error,
      );
    expect(rejection).not.toBeNull();
    expect(JSON.stringify(rejection.getResponse())).toContain('counterSaleOrderId');

    expect(Object.keys(new CreateDeliveryNoteDto())).not.toContain('counterSaleOrderId');
  });

  // CD-16
  it('findAll() hides counter-sale notes by default', async () => {
    const { service, prisma } = makeService();

    await service.findAll({} as QueryDeliveryNoteDto, scopedUser());

    const [{ where }] = prisma.deliveryNote.findMany.mock.calls[0];
    // The list is the office's DISPATCH worklist. A counter sale is a
    // collection, and it is not work anybody has to do.
    expect(where.counterSaleOrderId).toBeNull();
    // The count must use the SAME where, or the pagination total lies.
    expect(prisma.deliveryNote.count.mock.calls[0][0].where).toBe(where);
  });

  // CD-16
  it('findAll() shows them when the caller opts in explicitly', async () => {
    const { service, prisma } = makeService();

    await service.findAll({ includeCounterSales: true } as QueryDeliveryNoteDto, scopedUser());

    const [{ where }] = prisma.deliveryNote.findMany.mock.calls[0];
    expect(where).not.toHaveProperty('counterSaleOrderId');
  });

  // The boolean-query-coercion gotcha this repo keeps re-learning: without
  // @Type(() => String), enableImplicitConversion turns the string 'false' into
  // boolean true and the opt-out silently becomes an opt-in.
  it('includeCounterSales=false stays false through the global pipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const metadata = { type: 'query' as const, metatype: QueryDeliveryNoteDto };

    await expect(pipe.transform({ includeCounterSales: 'false' }, metadata)).resolves.toEqual(
      expect.objectContaining({ includeCounterSales: false }),
    );
    await expect(pipe.transform({ includeCounterSales: 'true' }, metadata)).resolves.toEqual(
      expect.objectContaining({ includeCounterSales: true }),
    );
  });
});

/**
 * The real column list of `delivery_note_lines`, read from the generated client
 * rather than retyped here — so this stays true the day someone adds a column.
 */
const DELIVERY_NOTE_LINE_COLUMNS = new Set(
  Prisma.dmmf.datamodel.models
    .find((m) => m.name === 'DeliveryNoteLine')!
    .fields.filter((f) => f.kind === 'scalar')
    .map((f) => f.name),
);

/** Every row object handed to `deliveryNoteLine.createMany` across all calls. */
function writtenLineRows(prisma: any): Record<string, unknown>[] {
  return prisma.deliveryNoteLine.createMany.mock.calls.flatMap(([arg]: any) => arg.data);
}

/**
 * The desktop modal's exact line shape: prefilled from a sales order, so
 * `salesOrderLineId` is ALWAYS a real sales-order-line id, never undefined
 * (frontend .../westsides/delivery-notes/page.tsx builds it from `line.id`).
 */
function desktopLine(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'product-1',
    description: 'Cement 50kg',
    quantity: 2,
    unitId: 'unit-1',
    salesOrderLineId: 'so-line-1',
    ...overrides,
  };
}

describe('delivery-note lines are written with real columns only', () => {
  // REGRESSION. Before the fix this emitted `salesOrderLineId`, which is not a
  // column anywhere. Prisma forwards a DEFINED unknown argument to the engine
  // (it only strips `undefined`), so the engine rejected the whole INSERT with
  // PrismaClientValidationError — and because the modal cannot create a note
  // except from a sales order, EVERY desk-created delivery note failed.
  it('create() from a sales order does not write the phantom salesOrderLineId', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto({ lines: [desktopLine()] }), 'user-1');

    const rows = writtenLineRows(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('salesOrderLineId');
  });

  // The line data every other caller depends on must be untouched by the fix.
  it('create() still writes the full line payload it always did', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto({ lines: [desktopLine()] }), 'user-1');

    expect(writtenLineRows(prisma)[0]).toEqual({
      deliveryNoteId: 'dn-1',
      productId: 'product-1',
      description: 'Cement 50kg',
      // quantity fans out into both columns — ordered and delivered start equal.
      orderedQuantity: 2,
      deliveredQuantity: 2,
      unitId: 'unit-1',
    });
  });

  // update() re-creates lines from the same DTO type, so it had the same bug.
  it('update() does not write the phantom salesOrderLineId either', async () => {
    const { service, prisma } = makeService();

    await service.update('dn-1', { lines: [desktopLine()] } as any, 'user-1');

    const rows = writtenLineRows(prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('salesOrderLineId');
  });

  // The general invariant, not just the one field we know about: a key that is
  // not a column fails the INSERT at runtime and TypeScript cannot see it,
  // because `.map()` produces a non-fresh object with no excess-property check.
  it('every key written to deliveryNoteLine.createMany is a real column', async () => {
    const { service, prisma } = makeService();

    await service.create(createDto({ lines: [desktopLine()] }), 'user-1');
    await service.update('dn-1', { lines: [desktopLine()] } as any, 'user-1');

    const rows = writtenLineRows(prisma);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(DELIVERY_NOTE_LINE_COLUMNS).toContain(key);
      }
    }
  });

  // CD-9 from the POS side: the counter-sale path never emits the key, so it was
  // always immune. Pin that the fix did not change what it writes.
  it('POS-shaped lines (no salesOrderLineId key) write exactly the same columns', async () => {
    const desk = makeService();
    const pos = makeService();

    await desk.service.create(createDto({ lines: [desktopLine()] }), 'user-1');
    await pos.service.create(
      createDto({ lines: [desktopLine({ salesOrderLineId: undefined })] }),
      'user-1',
      { counterSaleOrderId: 'so-1' },
    );

    expect(Object.keys(writtenLineRows(pos.prisma)[0]).sort()).toEqual(
      Object.keys(writtenLineRows(desk.prisma)[0]).sort(),
    );
  });

  // The field stays ON the DTO on purpose. The global pipe runs
  // forbidNonWhitelisted, so deleting the property would turn the desktop's
  // existing payload into a 400 rather than fixing it — removing it for good is
  // a coordinated frontend change.
  it('the DTO still ACCEPTS salesOrderLineId, so the desktop payload is not a 400', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const body = {
      companyId: '11111111-1111-4111-8111-111111111111',
      salesOrderId: '22222222-2222-4222-8222-222222222222',
      deliveryDate: '2026-08-15T09:14:00.000Z',
      lines: [
        {
          productId: '33333333-3333-4333-8333-333333333333',
          quantity: 2,
          unitId: '44444444-4444-4444-8444-444444444444',
          salesOrderLineId: '55555555-5555-4555-8555-555555555555',
        },
      ],
    };

    const accepted: any = await pipe.transform(body, {
      type: 'body',
      metatype: CreateDeliveryNoteDto,
    });
    expect(accepted.lines[0].salesOrderLineId).toBe('55555555-5555-4555-8555-555555555555');
  });
});

/**
 * Pull the argument text of every `this.prisma.deliveryNote.<method>(...)` call
 * in a source file, by walking balanced parentheses from the opening bracket.
 *
 * A source-level guard rather than a behavioural one because the thing that
 * needs protecting is a POLICY that must hold for queries nobody has written
 * yet: an eighth delivery-note panel added next year fails this test unless it
 * opts in deliberately.
 */
function deliveryNoteQueryArgs(source: string): string[] {
  const blocks: string[] = [];
  const call = /this\.prisma\.deliveryNote\.(\w+)\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    let depth = 0;
    let index = call.lastIndex - 1;
    for (; index < source.length; index++) {
      if (source[index] === '(') depth++;
      else if (source[index] === ')' && --depth === 0) break;
    }
    blocks.push(source.slice(call.lastIndex, index));
  }
  return blocks;
}

function readModuleSource(...segments: string[]) {
  return readFileSync(join(__dirname, '..', ...segments), 'utf8');
}

describe('counter-sale notes stay off the office worklists', () => {
  // CD-13
  it('EVERY westsides-dashboard delivery-note query excludes counter sales', () => {
    const source = readModuleSource('westsides-dashboard', 'westsides-dashboard.service.ts');
    const blocks = deliveryNoteQueryArgs(source);

    // Seven today: the status groupBy, overdue, due-today, delivered-today, the
    // `recent` panel, the freshness aggregate, and the missing-driver/vehicle
    // data-quality worklist. A future eighth lands here too.
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    for (const block of blocks) {
      expect(block).toMatch(/NOT_A_COUNTER_SALE|counterSaleOrderId:\s*null/);
    }
  });

  // CD-14
  it('ordersAwaitingDelivery is deliberately NOT filtered — that number must fall', () => {
    const source = readModuleSource('westsides-dashboard', 'westsides-dashboard.service.ts');
    // Those orders were never awaiting delivery; the goods left at the counter.
    // Adding the discriminator here would "preserve" a figure that was wrong.
    expect(source).toContain('deliveryNotes: { none: { deletedAt: null } },');
  });

  // CD-15
  it('deliveryPerformance() excludes counter sales from its status breakdown', () => {
    const source = readModuleSource('westsides-reports', 'westsides-reports.service.ts');
    const body = source.slice(
      source.indexOf('async deliveryPerformance('),
      source.indexOf('this.prisma.deliveryNote.groupBy('),
    );
    // The report flags DRAFT / DISPATCHED / PARTIALLY_DELIVERED as WARNING
    // "need operational follow-up" — exactly what a counter note stranded
    // mid-chain would become.
    expect(body).toContain('counterSaleOrderId: null');
  });
});
