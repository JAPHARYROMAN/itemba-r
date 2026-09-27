/**
 * Legacy import path. The print picker is the PrintProfileButton island
 * (src/islands/PrintProfileButton.tsx); this re-export keeps the pre-rebuild
 * company-profile page working until it imports the island directly.
 * Deleted with the legacy components in WP3.1.
 */
export { default } from '@/islands/PrintProfileButton';
export type { PrintProfileButtonProps, PrintProfileOption } from '@/islands/PrintProfileButton';
