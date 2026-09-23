'use client';

import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Btn, PageSpinner, type ScopeValue } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet } from '@/lib/api-client';
import { WorkspaceDraftShelf, type WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import {
  useUnsavedWork,
  useUnsavedWorkScopeId,
} from '@/components/workspace/unsaved-work-provider';
import { useInventoryWorkspace } from './inventory-workspace-context';
import { useWorkspaceState } from '@/components/workspace/workspace-session';
import type { Unit, UnitConversion } from '@/components/workspace/unit-types';
import type { Product, ProductCreateResponse } from '@/components/workspace/product-types';
import type { ProductCategory, ProductFamily } from '@/components/workspace/catalogue-types';

import { adjustmentActions, type AdjustmentAction } from './inventory-adjustment-types';
import { DAMAGE_ACTIONS, type DamageAction } from './inventory-damage-types';

const AdjustmentEditor = lazy(() =>
  import('./inventory-adjustment-editor').then((m) => ({ default: m.AdjustmentEditor })),
);
const BatchEditor = lazy(() =>
  import('./inventory-batch-editor').then((m) => ({ default: m.BatchEditor })),
);
const DamageEditor = lazy(() =>
  import('./inventory-damage-editor').then((m) => ({ default: m.DamageEditor })),
);
const UnitEditor = lazy(() =>
  import('@/components/workspace/unit-editors').then((m) => ({ default: m.UnitEditor })),
);
const ConversionEditor = lazy(() =>
  import('@/components/workspace/unit-editors').then((m) => ({ default: m.ConversionEditor })),
);
const CategoryEditor = lazy(() =>
  import('@/components/workspace/catalogue-editors').then((m) => ({ default: m.CategoryEditor })),
);
const FamilyEditor = lazy(() =>
  import('@/components/workspace/catalogue-editors').then((m) => ({ default: m.FamilyEditor })),
);
const ProductEditor = lazy(() =>
  import('@/components/workspace/product-editor').then((m) => ({ default: m.ProductEditor })),
);
const ActionReview = lazy(() =>
  import('./inventory-action-review').then((m) => ({ default: m.InventoryActionReview })),
);
const productReadPermissions = [
  'products.view',
  'pos.create',
  'sales.create',
  'purchases.create',
  'inventory.view',
  'inventory.adjustments.create',
  'operations.dashboard.view',
];

type StockKind = 'adjustment' | 'batch' | 'damage';
type DefinitionKind = 'unit' | 'conversion' | 'category' | 'family' | 'product';
type ActionKind = 'adjustment-action' | 'damage-action';
type ActionEntry =
  | { kind: 'adjustment-action'; id: string; action: AdjustmentAction }
  | { kind: 'damage-action'; id: string; action: DamageAction };
type Kind = StockKind | DefinitionKind | ActionKind;
type DefinitionEntry =
  | { kind: 'product'; record?: Product; companyId?: string; divisionId?: string }
  | { kind: 'unit'; record?: Unit; companyId?: string }
  | { kind: 'conversion'; record?: UnitConversion; companyId?: string }
  | {
      kind: 'category';
      record?: ProductCategory;
      companyId?: string;
      retainedParent?: ProductCategory;
    }
  | { kind: 'family'; record?: ProductFamily; category: ProductCategory; divisionId?: string };
type Entry = (
  | DefinitionEntry
  | ActionEntry
  | { kind: StockKind; scope: ScopeValue; productId?: string }
) & {
  source?: WorkspaceDraft;
};
const permissions: Record<Kind, string[]> = {
  adjustment: ['inventory.adjustments.create'],
  batch: ['product_batches.manage'],
  damage: ['stock_damage.create'],
  unit: ['units.view', 'units.manage'],
  conversion: ['units.view', 'units.manage'],
  category: ['product_categories.view', 'product_categories.manage'],
  family: ['product_categories.view', 'product_categories.manage'],
  product: [],
  'adjustment-action': [],
  'damage-action': [],
};
const messages: Record<Kind, string> = {
  adjustment: 'Stock count saved.',
  batch: 'Batch saved.',
  damage: 'Damage report saved.',
  unit: 'Unit saved.',
  conversion: 'Conversion saved.',
  category: 'Category saved.',
  family: 'Product family saved.',
  product: 'Product saved.',
  'adjustment-action': 'Adjustment updated.',
  'damage-action': 'Damage report updated.',
};
const Context = createContext<{
  open: (entry: Entry) => void;
  revision: number;
  fromAnotherWindow: boolean;
} | null>(null);
function useInventoryChanges() {
  const [owner] = useState(() => crypto.randomUUID());
  const [change, setChange] = useWorkspaceState('inventory.recordChanges', {
    revision: 0,
    owner: '',
  });
  return {
    revision: change.revision,
    fromAnotherWindow: change.owner !== owner,
    notify: () => setChange((previous) => ({ revision: previous.revision + 1, owner })),
  };
}
export function useInventoryStateKey(view: string) {
  const scope = useUnsavedWorkScopeId(),
    workspace = useInventoryWorkspace();
  return `${workspace ? 'inventory' : 'erp.inventory'}.${scope || 'main'}.${view}`;
}
function useDraftController(
  onSaved: (message: string) => void,
  viewKey?: string,
  onImageChanged?: () => void,
) {
  const [editor, setEditor] = useState<(Entry & { key: string }) | null>(null);
  const { hasPermission } = useAuth();
  const permission = useRef(hasPermission);
  useLayoutEffect(() => {
    permission.current = hasPermission;
  }, [hasPermission]);
  const { request } = useUnsavedWork(),
    scope = useUnsavedWorkScopeId();
  const [creation, setCreation] = useWorkspaceState<{
    name: string;
    generated: number;
    skipped: ProductCreateResponse['skippedFamilyProducts'];
  } | null>(`inventory.${scope || 'main'}.productCreation`, null);
  const reader = useRef<AbortController | null>(null);
  useEffect(() => () => reader.current?.abort(), []);
  const previousView = useRef(viewKey);
  useEffect(() => {
    if (previousView.current !== viewKey) {
      previousView.current = viewKey;
      reader.current?.abort();
      setEditor(null);
    }
  }, [viewKey]);
  const canOpen = (kind: Kind, editing = false, action?: string) => {
    if (kind === 'adjustment-action')
      return (
        !!action &&
        Object.hasOwn(adjustmentActions, action) &&
        (permission.current('inventory.view') ||
          permission.current('inventory.adjustments.create')) &&
        permission.current(adjustmentActions[action as AdjustmentAction].permission)
      );
    if (kind === 'damage-action')
      return (
        !!action &&
        Object.hasOwn(DAMAGE_ACTIONS, action) &&
        permission.current('stock_damage.view') &&
        permission.current(DAMAGE_ACTIONS[action as DamageAction].permission)
      );
    return (
      Object.hasOwn(permissions, kind) &&
      permissions[kind].every((p) => permission.current(p)) &&
      (kind !== 'product' ||
        (permission.current(editing ? 'products.update' : 'products.create') &&
          (!editing || productReadPermissions.some((p) => permission.current(p))))) &&
      (kind !== 'family' ||
        permission.current('products.view') ||
        permission.current('operations.dashboard.view'))
    );
  };
  const open = (entry: Entry) => {
    if (
      !canOpen(
        entry.kind,
        entry.kind === 'product' && !!entry.record,
        'action' in entry ? entry.action : undefined,
      )
    )
      throw new Error('Your current role cannot open this Inventory draft.');
    reader.current?.abort();
    request(
      () => setEditor({ ...entry, key: entry.source?.id ?? crypto.randomUUID() }),
      undefined,
      'close',
      { scope },
    );
  };
  const resume = async (source: WorkspaceDraft) => {
    const kind = source.context.kind as Kind;
    if (!canOpen(kind, !!source.context.recordId, source.context.action))
      throw new Error('Your current role cannot open this Inventory draft.');
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    const read = <T,>(path: string) => backendGet<T>(path, { signal: controller.signal });
    const id = source.context.recordId;
    try {
      if (kind === 'adjustment-action' || kind === 'damage-action') {
        if (!id) throw new Error('This action draft is missing its record.');
        if (kind === 'adjustment-action')
          open({ kind, id, action: source.context.action as AdjustmentAction, source });
        else open({ kind, id, action: source.context.action as DamageAction, source });
      } else if (kind === 'product') {
        const record = id ? await read<Product>(`/products/${encodeURIComponent(id)}`) : undefined;
        if (!controller.signal.aborted) open({ kind, record, source });
      } else if (kind === 'unit') {
        const record = id ? await read<Unit>(`/units/${encodeURIComponent(id)}`) : undefined;
        if (!controller.signal.aborted) open({ kind, record, source });
      } else if (kind === 'conversion') {
        const record = id
          ? await read<UnitConversion>(`/unit-conversions/${encodeURIComponent(id)}`)
          : undefined;
        if (!controller.signal.aborted) open({ kind, record, source });
      } else if (kind === 'category') {
        const record = id
          ? await read<ProductCategory>(`/product-categories/${encodeURIComponent(id)}`)
          : undefined;
        const values = source.values as
          | { createdParentId?: string; companyId?: string }
          | undefined;
        const retainedParent =
          !id && values?.createdParentId
            ? await read<ProductCategory>(
                `/product-categories/${encodeURIComponent(values.createdParentId)}`,
              )
            : undefined;
        if (retainedParent && retainedParent.companyId !== values?.companyId)
          throw new Error(
            'The created parent no longer belongs to this draft’s company. Your draft is still kept.',
          );
        if (!controller.signal.aborted) open({ kind, record, retainedParent, source });
      } else if (kind === 'family') {
        const record = id
          ? await read<ProductFamily>(`/products/families/${encodeURIComponent(id)}`)
          : undefined;
        const categoryId = record?.categoryId || source.context.categoryId;
        if (!categoryId) throw new Error('This family draft is missing its category.');
        const category = await read<ProductCategory>(
          `/product-categories/${encodeURIComponent(categoryId)}`,
        );
        if (record && category.companyId !== record.companyId)
          throw new Error(
            'The family and category no longer share a company. Your draft is still kept.',
          );
        if (!record && category.companyId !== source.context.companyId)
          throw new Error(
            'The category no longer belongs to this draft’s company. Your draft is still kept.',
          );
        if (!controller.signal.aborted) open({ kind, record, category, source });
      } else
        open({
          kind,
          source,
          scope: {
            companyId: source.context.companyId || '',
            divisionId: source.context.divisionId || '',
            branchId: source.context.branchId || '',
          },
          productId: source.context.productId || '',
        });
    } catch (cause) {
      if (!controller.signal.aborted) throw cause;
    }
  };
  const close = () => setEditor(null);
  const saved = (result?: ProductCreateResponse) => {
    if (!editor) return;
    if (editor.kind === 'product' && !editor.record && result)
      setCreation({
        name: result.name,
        generated: result.generatedFamilyProducts?.length || 0,
        skipped: result.skippedFamilyProducts,
      });
    close();
    onSaved(
      editor.kind === 'product' && result
        ? `“${result.name}” ${editor.record ? 'updated' : 'created'}.`
        : messages[editor.kind],
    );
  };
  const results =
    creation &&
    (creation.generated > 0 || !!creation.skipped?.length) &&
    (hasPermission('products.create') || productReadPermissions.some((p) => hasPermission(p))) ? (
      <section
        className="workspace-notice"
        role="status"
        aria-label="Product family creation results"
      >
        <p>
          {creation.name}: {creation.generated} additional family-size products created.
        </p>
        {!!creation.skipped?.length && (
          <>
            <p>Skipped families:</p>
            <ul>
              {creation.skipped.map((f) => (
                <li key={f.productFamilyId}>
                  {f.familyName}: {f.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        <Btn variant="ghost" onClick={() => setCreation(null)}>
          Dismiss family results
        </Btn>
      </section>
    ) : null;
  const form = editor && (
    <Suspense fallback={<PageSpinner label="Opening Inventory draft" />}>
      {editor.kind === 'adjustment-action' ? (
        <ActionReview
          key={editor.key}
          kind="adjustment"
          id={editor.id}
          action={editor.action}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'damage-action' ? (
        <ActionReview
          key={editor.key}
          kind="damage"
          id={editor.id}
          action={editor.action}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'product' ? (
        <ProductEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId}
          divisionId={editor.divisionId}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
          onImageChanged={onImageChanged}
        />
      ) : editor.kind === 'unit' ? (
        <UnitEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId || ''}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'conversion' ? (
        <ConversionEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId || ''}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'category' ? (
        <CategoryEditor
          key={editor.key}
          record={editor.record}
          companyId={editor.companyId || ''}
          retainedParent={editor.retainedParent}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'family' ? (
        <FamilyEditor
          key={editor.key}
          record={editor.record}
          category={editor.category}
          divisionId={editor.divisionId}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'adjustment' ? (
        <AdjustmentEditor
          key={editor.key}
          scope={editor.scope}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : editor.kind === 'batch' ? (
        <BatchEditor
          key={editor.key}
          scope={editor.scope}
          productId={editor.productId || ''}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      ) : (
        <DamageEditor
          key={editor.key}
          scope={editor.scope}
          productId={editor.productId || ''}
          draftSource={editor.source}
          onClose={close}
          onSaved={saved}
        />
      )}
    </Suspense>
  );
  return { open, resume, form, results, activeDraftId: editor?.source?.id };
}
/** Shared Inventory shelf; successful saves refresh participating legacy registers too. */
export function InventoryDraftWorkspace({
  children,
  onSaved,
}: {
  children: ReactNode;
  onSaved: () => void;
}) {
  const { revision, fromAnotherWindow, notify } = useInventoryChanges();
  const [notice, setNotice] = useState('');
  const controller = useDraftController(
    (message) => {
      setNotice(message);
      notify();
      onSaved();
    },
    undefined,
    notify,
  );
  return (
    <Context.Provider value={{ open: controller.open, revision, fromAnotherWindow }}>
      <WorkspaceDraftShelf
        appId="inventory"
        onResume={controller.resume}
        activeDraftId={controller.activeDraftId}
      />
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {controller.results}
      {children}
      {controller.form}
    </Context.Provider>
  );
}
function useInventoryEditors(
  kinds: readonly Kind[],
  onSaved: (message: string) => void,
  viewKey?: string,
  refreshWithParent: boolean | 'other-window' = false,
) {
  const parent = useContext(Context);
  const { revision: localRevision, notify } = useInventoryChanges();
  const localMessage = useRef('');
  const local = useDraftController(
    (message) => {
      localMessage.current = message;
      notify();
    },
    viewKey,
    () => {
      localMessage.current = 'Product image updated.';
      notify();
    },
  );
  const revision = parent?.revision ?? localRevision,
    seen = useRef(revision);
  useEffect(() => {
    if (seen.current !== revision) {
      seen.current = revision;
      if (
        !parent ||
        refreshWithParent === true ||
        (refreshWithParent === 'other-window' && parent.fromAnotherWindow)
      )
        onSaved(localMessage.current || 'Inventory records updated.');
      localMessage.current = '';
    }
  }, [revision, onSaved, parent, refreshWithParent]);
  return {
    open: parent?.open ?? local.open,
    drafts: parent ? null : (
      <>
        <WorkspaceDraftShelf
          appId="inventory"
          onResume={local.resume}
          activeDraftId={local.activeDraftId}
          filter={(draft) => kinds.includes(draft.context.kind as Kind)}
        />
        {local.results}
        {local.form}
      </>
    ),
  };
}
export function useInventoryDefinitionEditor(
  kinds: readonly DefinitionKind[],
  onSaved: (message: string) => void,
  viewKey?: string,
) {
  return useInventoryEditors(kinds, onSaved, viewKey, true);
}
export function useInventoryDraftEditor(
  kind: StockKind,
  scope: ScopeValue,
  productId: string,
  onSaved: () => void,
) {
  const actionKind =
    kind === 'adjustment' ? 'adjustment-action' : kind === 'damage' ? 'damage-action' : null;
  const editor = useInventoryEditors(
    actionKind ? [kind, actionKind] : [kind],
    onSaved,
    undefined,
    'other-window',
  );
  return {
    ...editor,
    open: () => editor.open({ kind, scope, productId }),
    openAction: (id: string, action: AdjustmentAction | DamageAction) => {
      if (kind === 'adjustment')
        editor.open({ kind: 'adjustment-action', id, action: action as AdjustmentAction });
      else if (kind === 'damage')
        editor.open({ kind: 'damage-action', id, action: action as DamageAction });
    },
  };
}
