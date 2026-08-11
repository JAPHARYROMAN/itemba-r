/**
 * Product image upload rules, shared by the controller (multer interceptor)
 * and the service (defensive re-validation + storage bookkeeping).
 *
 * Images ride on the existing documents storage: bytes are written through
 * DocumentsService.createFromBuffer and linked back to the product via
 * ownerType TRANSACTION + ownerId (there is no PRODUCT owner type) plus the
 * `product-image` tag. `Product.imageUrl` stores the products-scoped serving
 * path so POS-permission holders can fetch the image without `documents.view`.
 */

export const PRODUCT_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Tag that marks a Document row as a product image. */
export const PRODUCT_IMAGE_TAG = 'product-image';

/** Backend-relative URL the image is served from (GET, product-read permissions). */
export function productImageUrl(productId: string): string {
  return `/products/${productId}/image`;
}
