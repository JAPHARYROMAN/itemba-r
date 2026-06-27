'use client';

import { useEffect } from 'react';

/**
 * Marks <body> while the company-profile page is mounted so that ANY print of
 * this page (the picker button OR a direct Ctrl+P) renders the light print
 * layouts instead of the dark cinematic web view. The PrintProfileButton still
 * sets `data-print-profile` to choose a specific profile; without it, print
 * defaults to the full group profile. See the `data-print-scope` rules in
 * globals.css. Renders nothing.
 */
export default function CompanyProfilePrintScope() {
  useEffect(() => {
    document.body.dataset.printScope = 'company-profile';
    return () => {
      delete document.body.dataset.printScope;
    };
  }, []);

  return null;
}
