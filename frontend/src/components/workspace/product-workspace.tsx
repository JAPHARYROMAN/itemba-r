'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useWorkspaceSearchParams,
  useWorkspaceSearchReader,
  useWorkspaceRouter,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import {
  Btn,
  FormSelect,
  Modal,
  PageHeader,
  PageToolbar,
  PermissionDeniedState,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useInventoryWorkspace } from '@/features/inventory/inventory-workspace-context';
import { backendDelete } from '@/lib/api-client';
import { backendAllPages } from '@/lib/backend-all-pages';
import { rowsToCsv, cellToString, downloadTextFile } from '@/lib/report-export';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { ProductRegister } from './product-register';
import { useUnsavedWork, useUnsavedWorkScopeId } from './unsaved-work-provider';
import { CatalogueChoiceError } from './catalogue-editors';
import { useWorkspaceState } from './workspace-session';
import {
  useInventoryDefinitionEditor,
  useInventoryStateKey,
} from '@/features/inventory/inventory-drafts';
import {
  productLabel,
  priceSourceLabel,
  productQuantity,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
} from './product-form';
import type { Product, Company, Division, Branch, Category, ProductFamily } from './product-types';
import './workspace.css';
import './catalogue-workspace.css';
import './product-workspace.css';

export const productFamilyLabel = (r: Product) =>
  r.productFamily
    ? [r.productFamily.brand, r.productFamily.name].filter(Boolean).join(' · ')
    : r.productFamilyId || 'No family';
export const productVariant = (r: Product) =>
  [r.variantName, r.variantColor, r.variantSize, r.variantFinish].filter(Boolean).join(' · ');
const numeric = (value: number | string | null | undefined) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function productLowStock(r: Product) {
  const available = numeric(r.availableQuantity),
    reorder = numeric(r.reorderLevel);
  return r.trackInventory && available !== null && reorder !== null && available <= reorder;
}
export function productExportRows(records: Product[], branchId: string) {
  return records.map((r) => ({
    Code: r.productCode || '',
    Name: r.name,
    Family: r.productFamilyId ? productFamilyLabel(r) : '',
    Variant: productVariant(r),
    Category: r.category?.name || r.categoryId,
    Company: r.company?.name || r.companyId,
    Division: r.division?.name || r.divisionId || 'Company-wide',
    Type: productLabel(r.productType),
    Unit: r.baseUnit?.symbol || r.baseUnit?.name || r.baseUnitId,
    Selling: numeric(
      r.effectiveSellingPrice !== undefined ? r.effectiveSellingPrice : r.defaultSellingPrice,
    ),
    Purchase: numeric(
      r.effectivePurchasePrice !== undefined ? r.effectivePurchasePrice : r.defaultPurchasePrice,
    ),
    Wholesale: numeric(
      r.effectiveWholesalePrice !== undefined ? r.effectiveWholesalePrice : r.wholesalePrice,
    ),
    Retail: numeric(r.effectiveRetailPrice !== undefined ? r.effectiveRetailPrice : r.retailPrice),
    'Price source': priceSourceLabel(r.priceSource),
    ...(branchId
      ? {
          'On hand': r.trackInventory ? numeric(r.inventoryBalance?.quantityOnHand) : null,
          Available: r.trackInventory ? numeric(r.availableQuantity) : null,
          'Reorder level': r.trackInventory ? numeric(r.reorderLevel) : null,
        }
      : {}),
    Status: productLabel(r.status),
  }));
}

export function ProductDelete({
  record,
  onClose,
  onDeleted,
}: {
  record: Product;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const allowed = hasPermission('products.delete');
  const remove = async () => {
    if (busy || !allowed) return;
    setBusy(true);
    setError('');
    try {
      await backendDelete(`/products/${record.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete this product.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`Delete ${record.name}?`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" loading={busy} disabled={!allowed} onClick={() => void remove()}>
            Delete product
          </Btn>
        </>
      }
    >
      <p className="catalogue-help">
        Delete “{record.name}”{record.productCode ? ` (${record.productCode})` : ''} from the
        catalogue. Products with inventory, sales or purchase history cannot be deleted.
      </p>
      {error && (
        <p role="alert" className="workspace-notice">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function ProductWorkspace() {
  const workspace = useInventoryWorkspace();
  const params = useWorkspaceSearchParams();
  const readSearch = useWorkspaceSearchReader();
  const router = useWorkspaceRouter();
  const pathname = useWorkspacePathname();
  const { request } = useUnsavedWork();
  const workScope = useUnsavedWorkScopeId();
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('products.view');
  const externalSearch = workspace?.searchQuery || '';
  const stateKey = useInventoryStateKey('products');
  const [localScope, setLocalScope] = useWorkspaceState(stateKey + '.scope', {
    companyId: '',
    divisionId: '',
    branchId: '',
  });
  const scope = workspace?.embedded ? workspace.scope : localScope;
  const { companyId, divisionId, branchId } = scope;
  const scopeKey = JSON.stringify([companyId, divisionId, branchId]);
  const [categorySelection, setCategorySelection] = useWorkspaceState(stateKey + '.category', {
    scope: scopeKey,
    categoryId: params.get('categoryId') || '',
    productFamilyId: params.get('productFamilyId') || '',
  });
  const categoryId = categorySelection.categoryId;
  const productFamilyId = categorySelection.productFamilyId;
  const [productType, setProductType] = useWorkspaceState(
      stateKey + '.type',
      params.get('productType') || '',
    ),
    [status, setStatus] = useWorkspaceState(stateKey + '.status', params.get('status') || ''),
    [priceSource, setPriceSource] = useWorkspaceState(
      stateKey + '.priceSource',
      params.get('priceSource') || '',
    );
  const urlFilters = JSON.stringify(
    ['categoryId', 'productFamilyId', 'productType', 'status', 'priceSource'].map((key) => [
      key,
      params.get(key),
    ]),
  );
  useEffect(() => {
    const incoming = Object.fromEntries(JSON.parse(urlFilters)) as Record<string, string | null>;
    if (incoming.categoryId !== null || incoming.productFamilyId !== null)
      setCategorySelection((previous) => {
        const categoryId = incoming.categoryId ?? previous.categoryId;
        const productFamilyId = incoming.productFamilyId ?? previous.productFamilyId;
        return previous.categoryId === categoryId && previous.productFamilyId === productFamilyId
          ? previous
          : { ...previous, categoryId, productFamilyId };
      });
    if (incoming.productType !== null) setProductType(incoming.productType);
    if (incoming.status !== null) setStatus(incoming.status);
    if (incoming.priceSource !== null) setPriceSource(incoming.priceSource);
  }, [urlFilters, setCategorySelection, setProductType, setStatus, setPriceSource]);
  const [searchState, setSearchState] = useWorkspaceState(stateKey + '.search', {
    external: externalSearch,
    value: externalSearch,
  });
  const search = workspace?.embedded
    ? externalSearch
    : searchState.external === externalSearch
      ? searchState.value
      : externalSearch;
  const setSearch = (value: string) => setSearchState({ external: externalSearch, value });
  const [query, setQuery] = useState(search.trim());
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const filters = {
    companyId,
    divisionId,
    branchId,
    categoryId,
    productFamilyId,
    productType,
    status,
    priceSource,
    search: query,
  };
  const filterKey = JSON.stringify(filters);
  const [pagination, setPagination] = useWorkspaceState(stateKey + '.pagination', {
    key: filterKey,
    page: 1,
  });
  const page = pagination.key === filterKey ? pagination.page : 1;
  const setPage = (value: number) => setPagination({ key: filterKey, page: value });
  const result = useWorkspaceResource<{ data: Product[]; total: number }>(
    '/products',
    { ...filters, page, limit: 20 },
    canRead,
  );
  const requestedProductId = params.get('productId');
  const requestedSignature = JSON.stringify([scopeKey, requestedProductId]);
  const requestedSelection = useRef(requestedSignature);
  const [selection, setSelection] = useWorkspaceState<{ scope: string; id: string | null }>(
    stateKey + '.selectedId',
    { scope: scopeKey, id: requestedProductId },
  );
  const selectedId = selection.scope === scopeKey ? selection.id : requestedProductId;
  const setSelectedId = (id: string | null) => setSelection({ scope: scopeKey, id });
  const [selectedSnapshot, setSelectedSnapshot] = useState<{
    scope: string;
    record: Product;
  } | null>(null);
  useEffect(() => {
    if (requestedSelection.current === requestedSignature) return;
    requestedSelection.current = requestedSignature;
    setSelectedSnapshot(null);
    setSelection({ scope: scopeKey, id: requestedProductId });
  }, [requestedSignature, requestedProductId, scopeKey, setSelection]);
  const selectedRow = result.data?.data.find((record) => record.id === selectedId);
  const snapshot =
    selectedSnapshot?.scope === scopeKey && selectedSnapshot.record.id === selectedId
      ? selectedSnapshot.record
      : undefined;
  const detail = useWorkspaceResource<Product>(
    `/products/${encodeURIComponent(selectedId || '')}`,
    {},
    canRead && !!selectedId && !selectedRow && !snapshot,
  );
  const selectedSource = selectedRow || snapshot || detail.data || undefined;
  const selected =
    selectedSource?.id === selectedId &&
    (!companyId || selectedSource.companyId === companyId) &&
    (!divisionId || !selectedSource.divisionId || selectedSource.divisionId === divisionId)
      ? selectedSource
      : undefined;
  const [retrievedAt, setRetrievedAt] = useState<number | null>(null);
  useEffect(() => {
    if (result.data) setRetrievedAt(Date.now());
  }, [result.data]);
  const guardChange = (action: () => void) =>
    request(action, undefined, 'close', { scope: workScope });
  const changeCatalogFilters = (
    changes: Partial<
      Record<'categoryId' | 'productFamilyId' | 'productType' | 'status' | 'priceSource', string>
    >,
  ) =>
    guardChange(() => {
      if ('categoryId' in changes || 'productFamilyId' in changes)
        setCategorySelection((previous) => ({
          ...previous,
          ...('categoryId' in changes ? { categoryId: changes.categoryId! } : {}),
          ...('productFamilyId' in changes ? { productFamilyId: changes.productFamilyId! } : {}),
        }));
      if (changes.productType !== undefined) setProductType(changes.productType);
      if (changes.status !== undefined) setStatus(changes.status);
      if (changes.priceSource !== undefined) setPriceSource(changes.priceSource);
      const next = readSearch();
      Object.entries(changes).forEach(([key, value]) => next.set(key, value));
      router.replace(`${pathname}?${next}`, { scroll: false });
    });
  const selectRecord = (record: Product | null) =>
    guardChange(() => {
      setSelectedId(record?.id || null);
      setSelectedSnapshot(record ? { scope: scopeKey, record } : null);
      if (workspace?.embedded) {
        const next = readSearch();
        if (record) next.set('productId', record.id);
        else next.delete('productId');
        router.replace(`${pathname}?${next}`, { scroll: false });
      }
    });
  const refreshProduct = () =>
    guardChange(() => {
      setSelectedSnapshot(null);
      result.reload();
      detail.reload();
    });
  useEffect(() => {
    if (result.data && page > 1 && !result.data.data.length)
      setPagination({ key: filterKey, page: page - 1 });
  }, [result.data, page, filterKey, setPagination]);
  const companies = useWorkspaceChoices<Company>(
    '/companies',
    {},
    canRead && !workspace?.embedded && hasPermission('companies.read'),
  );
  const divisions = useWorkspaceChoices<Division>(
    '/divisions',
    { companyId },
    canRead && !workspace?.embedded && !!companyId && hasPermission('divisions.read'),
  );
  const branches = useWorkspaceChoices<Branch>(
    '/branches',
    { companyId, divisionId: divisionId || undefined, activeOnly: true },
    canRead && !!companyId && hasPermission('branches.read'),
  );
  const categories = useWorkspaceChoices<Category>(
    '/product-categories',
    { companyId: companyId || undefined },
    canRead && hasPermission('product_categories.view'),
  );
  const families = useWorkspaceChoices<ProductFamily>(
    '/products/families',
    {
      companyId: companyId || undefined,
      divisionId: divisionId || undefined,
      categoryId: categoryId || undefined,
    },
    canRead,
  );
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [notice, setNotice] = useState('');
  const [imageVersion, setImageVersion] = useState(() => Date.now());
  const entry = useInventoryDefinitionEditor(['product'], (message) => {
    setNotice(message);
    setImageVersion(Date.now());
    result.reload();
  });
  const [exportBusy, setExportBusy] = useState(false),
    [exportError, setExportError] = useState('');
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => {
    exportController.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportController.current?.abort();
  }, [filterKey, search, canRead]);
  const exportRows = async (format: 'csv' | 'pdf') => {
    if (!canRead || exportBusy || result.loading || result.error || search.trim() !== query) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const all = await backendAllPages<Product>('/products', filters, controller.signal);
      if (controller.signal.aborted) return;
      const rows = productExportRows(all, branchId);
      if (!rows.length) throw new Error('No matching products remain. Refresh this view.');
      if (format === 'csv')
        downloadTextFile('products.csv', 'text/csv;charset=utf-8', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 records. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Products',
          companyId: companyId || undefined,
          subtitle: [
            companyId
              ? companies.rows.find((c) => c.id === companyId)?.name || companyId
              : 'All accessible companies',
            divisionId &&
              `Division: ${divisions.rows.find((d) => d.id === divisionId)?.name || divisionId}`,
            branchId && `Branch: ${branches.rows.find((b) => b.id === branchId)?.name || branchId}`,
            categoryId &&
              `Category: ${categories.rows.find((c) => c.id === categoryId)?.name || categoryId}`,
            productFamilyId &&
              `Family: ${families.rows.find((f) => f.id === productFamilyId)?.name || productFamilyId}`,
            query && `Search: ${query}`,
            productType && productLabel(productType),
            status && productLabel(status),
            priceSource && priceSourceLabel(priceSource),
          ]
            .filter(Boolean)
            .join(' · '),
          columns,
          rows: rows.map((r) => columns.map((c) => cellToString(r[c as keyof typeof r]))),
          numericColumns: columns
            .map((c, i) =>
              [
                'Selling',
                'Purchase',
                'Wholesale',
                'Retail',
                'On hand',
                'Available',
                'Reorder level',
              ].includes(c)
                ? i
                : -1,
            )
            .filter((i) => i >= 0),
          baseName: 'products',
        });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(err instanceof Error ? err.message : 'Unable to export products.');
    } finally {
      if (!controller.signal.aborted) setExportBusy(false);
    }
  };
  if (authLoading)
    return (
      <p role="status" className="workspace-notice">
        Loading workspace…
      </p>
    );
  if (!canRead) return <PermissionDeniedState description="Your role cannot view products." />;
  const rows = result.data?.data || [];
  const stat = (value: number | undefined) =>
    result.loading ? '…' : result.error ? 'Unavailable' : (value ?? '—');
  const create = hasPermission('products.create') && (
    <Btn onClick={() => entry.open({ kind: 'product', companyId, divisionId })}>New product</Btn>
  );
  const profileHref = (r: Product) => {
    const profileParams = new URLSearchParams();
    Object.entries({ companyId: companyId || r.companyId, divisionId, branchId, q: query }).forEach(
      ([key, value]) => {
        if (value) profileParams.set(key, value);
      },
    );
    Object.entries({ categoryId, productFamilyId, productType, status, priceSource }).forEach(
      ([key, value]) => {
        if (value || params.has(key)) profileParams.set(key, value);
      },
    );
    return `${workspace?.embedded ? '/inventory/products' : '/operations/products'}/${encodeURIComponent(r.id)}?${profileParams}`;
  };
  return (
    <div className="business-workspace record-workspace catalogue-workspace product-workspace">
      <PageHeader
        title="Products"
        subtitle="Your catalogue, with prices and stock in view."
        breadcrumbs={[{ label: 'Operations', href: '/operations' }, { label: 'Products' }]}
        actions={!workspace?.embedded && create}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching products</span>
          <strong>{stat(result.data?.total)}</strong>
        </div>
        {PRODUCT_STATUSES.map((s) => (
          <div key={s}>
            <span>{productLabel(s)} on this page</span>
            <strong>{stat(rows.filter((r) => r.status === s).length)}</strong>
          </div>
        ))}
      </div>
      <p className="catalogue-help">
        {branchId
          ? `Stock quantities refer to ${branches.rows.find((branch) => branch.id === branchId)?.name || 'the selected branch'}. `
          : 'Choose a company and branch to see available stock. '}
        {retrievedAt && `Retrieved ${new Date(retrievedAt).toLocaleTimeString('en-GB')}. `}
        CSV includes every matching product; PDF supports up to 5,000.
      </p>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      {entry.drafts}
      <CatalogueChoiceError label="Company" source={companies} />
      <CatalogueChoiceError label="Division" source={divisions} />
      <CatalogueChoiceError label="Branch" source={branches} />
      <CatalogueChoiceError label="Category" source={categories} />
      <CatalogueChoiceError label="Family" source={families} />
      {exportError && (
        <p className="workspace-notice" role="alert">
          {exportError} Retry using the export buttons.
        </p>
      )}
      <PageToolbar
        search={search}
        onSearch={workspace?.embedded ? undefined : (value) => guardChange(() => setSearch(value))}
        searchPlaceholder="Search products…"
        collapsibleFilters
        activeFilterCount={
          [
            companyId,
            divisionId,
            branchId,
            categoryId,
            productFamilyId,
            productType,
            status,
            priceSource,
          ].filter(Boolean).length
        }
        filters={
          <>
            {!workspace?.embedded && (
              <>
                {hasPermission('companies.read') && (
                  <FormSelect
                    label="Company filter"
                    value={companyId}
                    disabled={companies.loading || !!companies.error}
                    onChange={(e) =>
                      guardChange(() =>
                        setLocalScope({ companyId: e.target.value, divisionId: '', branchId: '' }),
                      )
                    }
                  >
                    <option value="">All accessible companies</option>
                    {companies.rows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </FormSelect>
                )}
                {hasPermission('divisions.read') && (
                  <FormSelect
                    label="Division filter"
                    value={divisionId}
                    disabled={!companyId || divisions.loading || !!divisions.error}
                    onChange={(e) =>
                      guardChange(() =>
                        setLocalScope((p) => ({ ...p, divisionId: e.target.value, branchId: '' })),
                      )
                    }
                  >
                    <option value="">All divisions</option>
                    {divisions.rows.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </FormSelect>
                )}
                {hasPermission('branches.read') && (
                  <FormSelect
                    label="Branch filter"
                    value={branchId}
                    disabled={!companyId || branches.loading || !!branches.error}
                    onChange={(e) =>
                      guardChange(() => setLocalScope((p) => ({ ...p, branchId: e.target.value })))
                    }
                  >
                    <option value="">All branches</option>
                    {branches.rows.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </FormSelect>
                )}
              </>
            )}
            {hasPermission('product_categories.view') && (
              <FormSelect
                label="Category filter"
                value={categoryId}
                disabled={categories.loading || !!categories.error}
                onChange={(e) =>
                  changeCatalogFilters({
                    categoryId: e.target.value,
                    productFamilyId: '',
                  })
                }
              >
                <option value="">All categories</option>
                {categoryId && !categories.rows.some((category) => category.id === categoryId) && (
                  <option value={categoryId}>Selected category</option>
                )}
                {categories.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </FormSelect>
            )}
            <FormSelect
              label="Family filter"
              value={productFamilyId}
              disabled={families.loading || !!families.error}
              onChange={(e) =>
                changeCatalogFilters({
                  productFamilyId: e.target.value,
                })
              }
            >
              <option value="">All families</option>
              {productFamilyId &&
                !families.rows.some((family) => family.id === productFamilyId) && (
                  <option value={productFamilyId}>Selected family</option>
                )}
              {families.rows.map((f) => (
                <option key={f.id} value={f.id}>
                  {[f.brand, f.name].filter(Boolean).join(' · ')}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Type filter"
              value={productType}
              onChange={(e) => changeCatalogFilters({ productType: e.target.value })}
            >
              <option value="">All types</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {productLabel(t)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => changeCatalogFilters({ status: e.target.value })}
            >
              <option value="">All statuses</option>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {productLabel(s)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Price source filter"
              value={priceSource}
              onChange={(e) => changeCatalogFilters({ priceSource: e.target.value })}
            >
              <option value="">All price sources</option>
              {['PRODUCT_OVERRIDE', 'FAMILY_DEFAULT', 'MISSING'].map((s) => (
                <option key={s} value={s}>
                  {priceSourceLabel(s)}
                </option>
              ))}
            </FormSelect>
            <Btn
              variant="ghost"
              onClick={() =>
                guardChange(() => {
                  setLocalScope({ companyId: '', divisionId: '', branchId: '' });
                  setCategorySelection({ scope: scopeKey, categoryId: '', productFamilyId: '' });
                  setProductType('');
                  setStatus('');
                  setPriceSource('');
                  const next = readSearch();
                  ['categoryId', 'productFamilyId', 'productType', 'status', 'priceSource'].forEach(
                    (key) => next.set(key, ''),
                  );
                  router.replace(`${pathname}?${next}`, { scroll: false });
                  if (!workspace?.embedded) setSearch('');
                })
              }
            >
              Clear filters
            </Btn>
          </>
        }
        actions={
          <>
            {workspace?.embedded && create}
            <Btn variant="secondary" disabled={result.loading} onClick={refreshProduct}>
              Refresh
            </Btn>
            <Btn
              variant="secondary"
              disabled={!rows.length || exportBusy || search.trim() !== query}
              onClick={() => void exportRows('csv')}
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              disabled={!rows.length || exportBusy || search.trim() !== query}
              onClick={() => void exportRows('pdf')}
            >
              Export PDF
            </Btn>
          </>
        }
      />
      {exportBusy && (
        <p role="status" className="catalogue-help">
          Preparing the full filtered export…
        </p>
      )}
      <ProductRegister
        records={rows}
        total={result.data?.total || 0}
        page={page}
        selectedId={selectedId}
        selected={selected}
        loading={result.loading}
        error={result.error}
        detailLoading={detail.loading}
        detailError={
          detail.error ||
          (selectedSource && !selected ? 'This product is unavailable in the selected scope.' : '')
        }
        onRetry={result.reload}
        onDetailRetry={refreshProduct}
        onSelect={selectRecord}
        onClose={() => selectRecord(null)}
        onPage={(next) =>
          guardChange(() => {
            setSelectedId(null);
            setSelectedSnapshot(null);
            setPage(next);
            if (workspace?.embedded) {
              const params = readSearch();
              params.delete('productId');
              router.replace(`${pathname}?${params}`, { scroll: false });
            }
          })
        }
        scope={scope}
        branchLabel={
          branches.rows.find((branch) => branch.id === branchId)?.name || 'Selected branch'
        }
        retrievedAt={retrievedAt}
        imageVersion={imageVersion}
        profileHref={profileHref}
        onSaved={(updated) => {
          setNotice(`“${updated.name}” updated.`);
          setSelectedSnapshot({ scope: scopeKey, record: updated });
          setImageVersion(Date.now());
          result.reload();
        }}
        onAdjust={(record) =>
          entry.open({
            kind: 'adjustment',
            scope: { ...scope, companyId: record.companyId },
            productId: record.id,
          })
        }
        onDelete={(record) => guardChange(() => setDeleting(record))}
      />
      {deleting && (
        <ProductDelete
          record={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setNotice(`“${deleting.name}” deleted.`);
            setDeleting(null);
            result.reload();
          }}
        />
      )}
    </div>
  );
}
