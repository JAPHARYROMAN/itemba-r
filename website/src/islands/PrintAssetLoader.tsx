'use client';

import { useEffect } from 'react';
import { PRINTING_CLASS, activePrintProfile, loadPrintImages } from '@/lib/print-assets';

/**
 * Loads a print document's photos the moment a profile is picked for
 * printing, and never before (src/lib/print-assets.ts).
 *
 * It watches <body>: when `printing-company-profile` is on it (set by
 * PrintProfileButton, and by scripts/generate-profile-pdfs.mjs before it
 * waits for the images), the chosen profile's lazy images switch to eager.
 * A direct Ctrl+P (`beforeprint`) starts them too, although a browser may
 * print before they arrive; the print button and the PDFs wait for them.
 *
 * Rendered once, inside the print documents. Renders nothing.
 */
export default function PrintAssetLoader() {
  useEffect(() => {
    const body = document.body;
    const sync = () => {
      if (body.classList.contains(PRINTING_CLASS)) loadPrintImages(activePrintProfile());
    };
    const beforePrint = () => {
      loadPrintImages(activePrintProfile());
    };

    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ['class', 'data-print-profile'] });
    window.addEventListener('beforeprint', beforePrint);
    sync();

    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', beforePrint);
    };
  }, []);

  return null;
}
