#!/usr/bin/env node
/**
 * PLACEHOLDER: bundle/HTML budget checker (owned by work package 0.3).
 *
 * The real checker reads the Next build output and enforces the budgets in
 * the rebuild architecture (§7): shared JS <= 110 KB gzip, route JS <= 15 KB
 * (25 KB with EnquiryRouter and on /company-profile), CSS <= 30 KB gzip,
 * HTML <= 40 KB gzip (90 KB for /company-profile), no inline `opacity:0` in
 * .next/server/app/**\/*.html, and `'use client'` only in the allowlist.
 *
 * Until it lands this prints a warning and exits 0 so `npm run verify` can
 * reach the e2e step. It enforces nothing.
 */
console.warn('[budget] NOT IMPLEMENTED: scripts/check-budgets.mjs is a placeholder (WP0.3). No budgets were checked.');
