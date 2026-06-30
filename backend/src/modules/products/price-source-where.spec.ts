import { priceSourceWhere } from './price-source-where';

const PRODUCT_POSITIVE = {
  OR: [
    { defaultSellingPrice: { gt: 0 } },
    { retailPrice: { gt: 0 } },
    { wholesalePrice: { gt: 0 } },
  ],
};

describe('priceSourceWhere', () => {
  it('PRODUCT_OVERRIDE requires a positive price on the product itself', () => {
    expect(priceSourceWhere('PRODUCT_OVERRIDE')).toEqual(PRODUCT_POSITIVE);
  });

  it('FAMILY_DEFAULT requires no product price but a positive family price', () => {
    expect(priceSourceWhere('FAMILY_DEFAULT')).toEqual({
      AND: [
        { NOT: PRODUCT_POSITIVE },
        {
          productFamily: {
            OR: [
              { defaultSellingPrice: { gt: 0 } },
              { retailPrice: { gt: 0 } },
              { wholesalePrice: { gt: 0 } },
            ],
          },
        },
      ],
    });
  });

  it('MISSING requires neither product nor family price, and matches family-less products', () => {
    const where = priceSourceWhere('MISSING') as { AND: any[] };
    expect(where.AND[0]).toEqual({ NOT: PRODUCT_POSITIVE });
    // The "no inherited price" branch must include products with no family.
    expect(where.AND[1].OR).toContainEqual({ productFamilyId: null });
  });
});
