'use client';
import { InventoryActionReview } from './inventory-action-review';
import type { DamageAction } from './inventory-damage-types';
import type { WorkspaceDraft } from '@/components/workspace/workspace-drafts';
export function DamageActionDialog(props: {
  id: string;
  action: DamageAction;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  return <InventoryActionReview kind="damage" {...props} />;
}
