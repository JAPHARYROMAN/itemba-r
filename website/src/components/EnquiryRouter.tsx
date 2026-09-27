/**
 * Legacy import path. The enquiry form is the EnquiryRouter island
 * (src/islands/EnquiryRouter.tsx, logic in src/lib/enquiry-client.ts); this
 * re-export keeps the pre-rebuild pages working until they import the island
 * directly. Deleted with the legacy components in WP3.1.
 */
export { default } from '@/islands/EnquiryRouter';
export type { EnquiryRouterProps } from '@/islands/EnquiryRouter';
