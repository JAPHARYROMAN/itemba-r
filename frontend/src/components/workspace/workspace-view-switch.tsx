'use client';
import { List, Table2 } from 'lucide-react';
export function WorkspaceViewSwitch({
  value,
  onChange,
}: {
  value: 'focus' | 'ledger';
  onChange: (value: 'focus' | 'ledger') => void;
}) {
  return (
    <div className="workspace-view-switch" role="group" aria-label="Record layout">
      <button type="button" aria-pressed={value === 'focus'} onClick={() => onChange('focus')}>
        <List size={14} /> Focus
      </button>
      <button type="button" aria-pressed={value === 'ledger'} onClick={() => onChange('ledger')}>
        <Table2 size={14} /> Ledger
      </button>
    </div>
  );
}
