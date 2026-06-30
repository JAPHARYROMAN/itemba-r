import { Prisma } from '@prisma/client';

export const PRICE_SOURCES = ['PRODUCT_OVERRIDE', 'FAMILY_DEFAULT', 'MISSING'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

// A positive (overriding) selling-side price on the product itself.
const productHasPositivePrice: Prisma.ProductWhereInput = {
  OR: [
    { defaultSellingPrice: { gt: 0 } },
    { retailPrice: { gt: 0 } },
    { wholesalePrice: { gt: 0 } },
  ],
};

// A positive selling-side price inherited from the product family.
const familyHasPositivePrice: Prisma.ProductWhereInput = {
  productFamily: {
    OR: [
      { defaultSellingPrice: { gt: 0 } },
      { retailPrice: { gt: 0 } },
      { wholesalePrice: { gt: 0 } },
    ],
  },
};

// "No inherited price" must also match products with no family at all — the
// explicit `productFamilyId: null` branch covers the null relation, which a bare
// `NOT: { productFamily: { ... } }` does not reliably include.
const familyHasNoPositivePrice: Prisma.ProductWhereInput = {
  OR: [{ productFamilyId: null }, { NOT: familyHasPositivePrice }],
};

/**
 * Prisma `where` mirror of the `priceSource` computed in
 * `withProductListAliasesAndAvailability`:
 *  - PRODUCT_OVERRIDE: the product carries its own positive selling/retail/wholesale price
 *  - FAMILY_DEFAULT:   no product price, but the family supplies one
 *  - MISSING:          neither the product nor its family has a positive price
 */
export function priceSourceWhere(priceSource: PriceSource): Prisma.ProductWhereInput {
  switch (priceSource) {
    case 'PRODUCT_OVERRIDE':
      return productHasPositivePrice;
    case 'FAMILY_DEFAULT':
      return { AND: [{ NOT: productHasPositivePrice }, familyHasPositivePrice] };
    case 'MISSING':
      return { AND: [{ NOT: productHasPositivePrice }, familyHasNoPositivePrice] };
  }
}
