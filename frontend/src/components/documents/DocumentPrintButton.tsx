'use client';

import { Btn } from '@/components/ui';

export function DocumentPrintButton({ label = 'Print / Save PDF' }: { label?: string }) {
  return (
    <Btn type="button" size="sm" onClick={() => window.print()}>
      {label}
    </Btn>
  );
}
