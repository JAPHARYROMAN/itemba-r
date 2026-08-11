import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { ProductsService } from './products.service';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_TAG } from './product-image';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Fully-mocked unit tests for the product image upload validation and storage
 * bookkeeping. No Postgres / real Prisma client needed — mirrors the mock
 * style of generated-documents.service.spec.ts.
 */

function makeService() {
  const prisma = {
    product: {
      findFirst: jest.fn(async () => ({
        id: 'product-1',
        companyId: 'company-1',
        name: 'Coral White 4L',
        productCode: 'PRD-1',
        imageUrl: null,
      })),
      update: jest.fn(async ({ data }: any) => ({ id: 'product-1', ...data })),
    },
    document: {
      findFirst: jest.fn(async () => ({ id: 'doc-1' })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  } as any;

  const auditLogs = { log: jest.fn().mockResolvedValue(undefined) } as any;
  const companyScope = { assertCanAccessCompany: jest.fn().mockResolvedValue(undefined) } as any;
  const profit = { assertProductMasterPricing: jest.fn(), isStockProduct: jest.fn() } as any;
  const documents = {
    createFromBuffer: jest.fn(async () => ({ id: 'doc-1' })),
    readFileBuffer: jest.fn(async () => ({
      buffer: Buffer.from('bytes'),
      fileName: 'photo.png',
      mimeType: 'image/png',
    })),
  } as any;

  const service = new ProductsService(prisma, auditLogs, companyScope, profit, documents);
  return { service, prisma, auditLogs, companyScope, documents };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    roles: ['STAFF'],
    permissions: [],
    companyId: 'company-1',
    ...overrides,
  };
}

function imageFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake-image-bytes'),
    ...overrides,
  } as Express.Multer.File;
}

describe('ProductsService.setImage', () => {
  it('rejects a missing file', async () => {
    const { service, documents } = makeService();

    await expect(service.setImage('product-1', undefined, user())).rejects.toThrow(
      BadRequestException,
    );
    expect(documents.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects unsupported content types', async () => {
    const { service, documents } = makeService();

    await expect(
      service.setImage('product-1', imageFile({ mimetype: 'application/pdf' }), user()),
    ).rejects.toThrow(/Unsupported image type/);
    expect(documents.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects files above the 2 MB cap', async () => {
    const { service, documents } = makeService();

    await expect(
      service.setImage('product-1', imageFile({ size: PRODUCT_IMAGE_MAX_BYTES + 1 }), user()),
    ).rejects.toThrow(/2 MB or smaller/);
    expect(documents.createFromBuffer).not.toHaveBeenCalled();
  });

  it('stores the image via the documents storage and sets the servable imageUrl', async () => {
    const { service, prisma, companyScope, documents } = makeService();
    const actor = user();

    const result = await service.setImage('product-1', imageFile(), actor);

    expect(companyScope.assertCanAccessCompany).toHaveBeenCalledWith(
      actor,
      'company-1',
      AccessLevel.WRITE,
    );
    expect(documents.createFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        ownerId: 'product-1',
        companyId: 'company-1',
        tags: [PRODUCT_IMAGE_TAG],
      }),
      actor,
    );
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { imageUrl: '/products/product-1/image' },
    });
    expect(result).toEqual({ id: 'product-1', imageUrl: '/products/product-1/image' });
  });

  it('404s when the product does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValueOnce(null);

    await expect(service.setImage('missing', imageFile(), user())).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ProductsService.clearImage', () => {
  it('soft-deletes the image document and clears imageUrl', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValueOnce({
      id: 'product-1',
      companyId: 'company-1',
      name: 'Coral White 4L',
      productCode: 'PRD-1',
      imageUrl: '/products/product-1/image',
    });

    const result = await service.clearImage('product-1', user());

    expect(prisma.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: 'product-1', deletedAt: null }),
      }),
    );
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { imageUrl: null },
    });
    expect(result).toEqual({ id: 'product-1', imageUrl: null });
  });
});

describe('ProductsService.getImage', () => {
  it('404s when the product has no image', async () => {
    const { service } = makeService();

    await expect(service.getImage('product-1', user())).rejects.toThrow('Product has no image');
  });

  it('streams the newest image document through the documents storage', async () => {
    const { service, prisma, documents } = makeService();
    prisma.product.findFirst.mockResolvedValueOnce({
      id: 'product-1',
      companyId: 'company-1',
      name: 'Coral White 4L',
      productCode: 'PRD-1',
      imageUrl: '/products/product-1/image',
    });
    const actor = user();

    const result = await service.getImage('product-1', actor);

    expect(prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: 'product-1',
          tags: { has: PRODUCT_IMAGE_TAG },
          deletedAt: null,
        }),
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(documents.readFileBuffer).toHaveBeenCalledWith('doc-1', actor);
    expect(result.mimeType).toBe('image/png');
  });
});
