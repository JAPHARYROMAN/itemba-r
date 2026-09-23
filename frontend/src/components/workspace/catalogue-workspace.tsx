'use client';
import { useEffect, useRef, useState } from 'react';
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
import { backendAllPages } from '@/lib/backend-all-pages';
import { rowsToCsv, cellToString, downloadTextFile } from '@/lib/report-export';
import { downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { RecordBrowser } from './record-browser';
import { CategoryAction, CatalogueChoiceError } from './catalogue-editors';
import {
  CATEGORY_TYPES,
  categoryTypeLabel,
  familyLabel,
  catalogueMoney,
  priceReviewReason,
  type ProductCategory,
  type ProductFamily,
  type PriceReviewProduct,
  type CatalogueCompany,
} from './catalogue-types';
import { useWorkspaceState } from './workspace-session';
import {
  useInventoryDefinitionEditor,
  useInventoryStateKey,
} from '@/features/inventory/inventory-drafts';
import './workspace.css';
import './catalogue-workspace.css';

type CategoryPage = {
  data: ProductCategory[];
  total: number;
  counts?: { active: number; inactive: number; total: number };
};
export function CatalogueWorkspace() {
  const workspace = useInventoryWorkspace();
  const { hasPermission, loading: authLoading } = useAuth();
  const canRead = !authLoading && hasPermission('product_categories.view');
  const canManage = hasPermission('product_categories.manage');
  const canFamilies = hasPermission('products.view') || hasPermission('operations.dashboard.view');
  const externalKey = JSON.stringify([workspace?.scope, workspace?.searchQuery]);
  const stateKey = useInventoryStateKey('catalogue.' + externalKey);
  const [company, setCompany] = useWorkspaceState(
    stateKey + '.company',
    workspace?.scope.companyId || '',
  );
  const companyId = workspace?.embedded ? workspace.scope.companyId : company;
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', workspace?.searchQuery || '');
  const [query, setQuery] = useState(search.trim());
  const [type, setType] = useWorkspaceState(stateKey + '.type', '');
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [action, setAction] = useState<{
    record: ProductCategory;
    action: 'delete' | 'status';
  } | null>(null);
  const [familyCategory, setFamilyCategory] = useWorkspaceState<{
    id: string;
    scope: string;
  } | null>(stateKey + '.familyCategory', null);
  const [notice, setNotice] = useState(''),
    [exportError, setExportError] = useState(''),
    [exportBusy, setExportBusy] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  const scopeKey = JSON.stringify([companyId, workspace?.scope.divisionId || '']);
  const familyId = familyCategory?.scope === scopeKey ? familyCategory.id : '';
  const familySource = useWorkspaceResource<ProductCategory>(
    familyId ? '/product-categories/' + encodeURIComponent(familyId) : '/product-categories',
    {},
    canRead && canFamilies && !!familyId,
  );
  const currentFamily = familySource.data;
  const previousExternal = useRef(externalKey);
  useEffect(() => {
    if (previousExternal.current === externalKey) return;
    previousExternal.current = externalKey;
    setSearch(workspace?.searchQuery || '');
    setQuery((workspace?.searchQuery || '').trim());
    setPage(1);
  }, [externalKey, workspace?.searchQuery, setSearch, setPage]);
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const filters = { companyId, search: query, categoryType: type, isActive: status };
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    exportController.current?.abort();
    setExportBusy(false);
    setExportError('');
    return () => exportController.current?.abort();
  }, [filterKey, canRead]);
  const result = useWorkspaceResource<CategoryPage>(
    '/product-categories',
    { ...filters, page, limit: 20 },
    canRead && !(familyId && canFamilies),
  );
  const companies = useWorkspaceChoices<CatalogueCompany>(
    '/companies',
    {},
    canRead && hasPermission('companies.read'),
  );
  useEffect(() => {
    if (result.data && !result.data.data.length && page > 1) setPage((p) => p - 1);
  }, [result.data, page, setPage]);
  const refresh = () => result.reload();
  const saved = (message: string) => {
    setAction(null);
    setNotice(message);
    refresh();
  };
  const entry = useInventoryDefinitionEditor(['category', 'family'], saved, familyId);
  const exportRows = async (format: 'csv' | 'pdf') => {
    if (exportBusy || !canRead || result.loading || result.error || search.trim() !== query) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportBusy(true);
    setExportError('');
    try {
      const records = await backendAllPages<ProductCategory>(
        '/product-categories',
        filters,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const rows = records.map((r) => ({
        Name: r.name,
        Type: categoryTypeLabel(r.categoryType),
        Parent: r.parentCategory?.name || r.parentCategoryId || '',
        Company: r.company?.name || r.companyId,
        Status: r.isActive ? 'Active' : 'Inactive',
        Description: r.description || '',
      }));
      if (!rows.length) throw new Error('No matching records remain. Refresh this view.');
      if (format === 'csv') downloadTextFile('product-categories.csv', 'text/csv', rowsToCsv(rows));
      else {
        if (rows.length > TABLE_PDF_MAX_ROWS)
          throw new Error(
            'PDF supports up to 5,000 records. Narrow the filters or use CSV for the complete register.',
          );
        const columns = Object.keys(rows[0]);
        await downloadTablePdf({
          title: 'Product categories',
          companyId: companyId || undefined,
          subtitle: [
            companyId
              ? companies.rows.find((c) => c.id === companyId)?.name || companyId
              : 'All accessible companies',
            query && `Search: ${query}`,
            type && categoryTypeLabel(type),
            status && (status === 'true' ? 'Active' : 'Inactive'),
          ]
            .filter(Boolean)
            .join(' · '),
          columns,
          rows: rows.map((r) => columns.map((c) => cellToString(r[c as keyof typeof r]))),
          baseName: 'product-categories',
        });
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setExportError(err instanceof Error ? err.message : 'Unable to export categories.');
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
  if (!canRead)
    return <PermissionDeniedState description="Your role cannot view product categories." />;
  if (familyId && canFamilies && !currentFamily)
    return (
      <div className="business-workspace">
        <Btn variant="secondary" onClick={() => setFamilyCategory(null)}>
          Back to categories
        </Btn>
        {familySource.error ? (
          <p role="alert" className="workspace-notice">
            {familySource.error} <Btn onClick={familySource.reload}>Retry category</Btn>
          </p>
        ) : (
          <p role="status">Loading category…</p>
        )}
      </div>
    );
  if (currentFamily && familyId && canFamilies)
    return (
      <FamilyWorkspace
        key={`${scopeKey}:${currentFamily.id}`}
        category={currentFamily}
        divisionId={workspace?.scope.divisionId || ''}
        onBack={() => {
          setFamilyCategory(null);
          refresh();
        }}
      />
    );
  const stat = (value?: number) =>
    result.loading ? '…' : result.error ? 'Unavailable' : (value ?? '—');
  const records = result.data?.data || [];
  const create = canManage && (
    <Btn onClick={() => entry.open({ kind: 'category', companyId })}>New category</Btn>
  );
  return (
    <div className="business-workspace record-workspace catalogue-workspace">
      <PageHeader
        title="Categories & families"
        subtitle="Organise the catalogue and its shared price defaults."
        breadcrumbs={[{ label: 'Operations', href: '/operations' }, { label: 'Categories' }]}
        actions={!workspace?.embedded && create}
      />
      <div className="workspace-summary">
        <div>
          <span>Matching categories</span>
          <strong>{stat(result.data?.total)}</strong>
        </div>
        <div>
          <span>Active across this scope</span>
          <strong>{stat(result.data?.counts?.active)}</strong>
        </div>
        <div>
          <span>Inactive across this scope</span>
          <strong>{stat(result.data?.counts?.inactive)}</strong>
        </div>
      </div>
      <p className="catalogue-help">
        Active and inactive totals include every page and follow company, search and type filters,
        before the status filter. CSV includes all matching categories; PDF supports up to 5,000.
      </p>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <CatalogueChoiceError label="Company" source={companies} />
      {exportError && (
        <p role="alert" className="workspace-notice">
          {exportError} Retry using the export buttons.
        </p>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search categories…"
        collapsibleFilters
        activeFilterCount={[companyId, status, type].filter(Boolean).length}
        filters={
          <>
            {!workspace?.embedded && hasPermission('companies.read') && (
              <FormSelect
                label="Company filter"
                value={companyId}
                disabled={companies.loading || !!companies.error}
                onChange={(e) => {
                  setCompany(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All accessible companies</option>
                {companies.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </FormSelect>
            )}
            <FormSelect
              label="Type filter"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {CATEGORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {categoryTypeLabel(t)}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Status filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </FormSelect>
            <Btn
              variant="ghost"
              onClick={() => {
                setCompany(workspace?.scope.companyId || '');
                setStatus('');
                setType('');
                setSearch('');
                setPage(1);
              }}
            >
              Clear filters
            </Btn>
          </>
        }
        actions={
          <>
            {workspace?.embedded && create}
            <Btn variant="secondary" disabled={result.loading} onClick={refresh}>
              Refresh
            </Btn>
            <Btn
              variant="secondary"
              disabled={!records.length || exportBusy || search.trim() !== query}
              onClick={() => void exportRows('csv')}
            >
              Export CSV
            </Btn>
            <Btn
              variant="secondary"
              disabled={!records.length || exportBusy || search.trim() !== query}
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
      {entry.drafts}
      <RecordBrowser<ProductCategory>
        stateKey={stateKey + '.record'}
        selectionScope={filterKey}
        key={filterKey}
        title="Categories"
        records={records}
        name={(r) => r.name}
        reference={(r) => categoryTypeLabel(r.categoryType)}
        status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
        fields={[
          { label: 'Company', value: (r) => r.company?.name || r.companyId },
          {
            label: 'Parent',
            value: (r) => r.parentCategory?.name || r.parentCategoryId || 'Top-level',
          },
        ]}
        details={[
          { label: 'Type', value: (r) => categoryTypeLabel(r.categoryType) },
          { label: 'Description', value: (r) => r.description || '—' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={refresh}
        page={page}
        onPage={setPage}
        pageSize={20}
        total={result.data?.total || 0}
        actions={(r) => (
          <>
            {canFamilies && (
              <Btn
                onClick={() => {
                  exportController.current?.abort();
                  setExportBusy(false);
                  setFamilyCategory({ id: r.id, scope: scopeKey });
                }}
              >
                View families
              </Btn>
            )}
            {canManage && (
              <>
                <Btn
                  variant="secondary"
                  onClick={() =>
                    entry.open({
                      kind: 'family',
                      category: r,
                      divisionId: workspace?.scope.divisionId,
                    })
                  }
                >
                  New family
                </Btn>
                <Btn
                  variant="secondary"
                  onClick={() => entry.open({ kind: 'category', record: r })}
                >
                  Edit category
                </Btn>
                <Btn variant="ghost" onClick={() => setAction({ record: r, action: 'status' })}>
                  {r.isActive ? 'Deactivate' : 'Activate'} category
                </Btn>
                <Btn variant="ghost" onClick={() => setAction({ record: r, action: 'delete' })}>
                  Delete category
                </Btn>
              </>
            )}
          </>
        )}
      />
      {action && (
        <CategoryAction
          {...action}
          onClose={() => setAction(null)}
          onSaved={() =>
            saved(action.action === 'delete' ? 'Category deleted.' : 'Category status updated.')
          }
        />
      )}
    </div>
  );
}

function FamilyWorkspace({
  category,
  divisionId,
  onBack,
}: {
  category: ProductCategory;
  divisionId: string;
  onBack: () => void;
}) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product_categories.manage');
  const canRead = hasPermission('products.view') || hasPermission('operations.dashboard.view');
  const stateKey = useInventoryStateKey('families.' + category.id + '.' + divisionId);
  const [search, setSearch] = useWorkspaceState(stateKey + '.search', '');
  const [query, setQuery] = useState(search.trim());
  const [status, setStatus] = useWorkspaceState(stateKey + '.status', '');
  const [page, setPage] = useWorkspaceState(stateKey + '.page', 1);
  const [review, setReview] = useState<ProductFamily | null>(null),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setPage]);
  const filters = {
    companyId: category.companyId,
    categoryId: category.id,
    divisionId,
    search: query,
    isActive: status,
  };
  const result = useWorkspaceResource<{ data: ProductFamily[]; total: number }>(
    '/products/families',
    { ...filters, page, limit: 20 },
    canRead,
  );
  useEffect(() => {
    if (result.data && !result.data.data.length && page > 1) setPage((p) => p - 1);
  }, [result.data, page, setPage]);
  const entry = useInventoryDefinitionEditor(['family'], (message) => {
    setNotice(message);
    result.reload();
  });
  return (
    <div className="business-workspace record-workspace catalogue-workspace">
      <div className="catalogue-family-heading">
        <Btn variant="secondary" onClick={onBack}>
          Back to categories
        </Btn>
        <div>
          <h2>{category.name}</h2>
          <p className="catalogue-help">
            Product families · {category.company?.name || category.companyId}
          </p>
        </div>
      </div>
      <p className="catalogue-help">
        Review shared prices and the products that inherit or override them.
        {divisionId
          ? ' Includes this division and company-wide families.'
          : ' Includes all divisions.'}
      </p>
      {notice && (
        <p role="status" className="workspace-notice">
          {notice}
        </p>
      )}
      <PageToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search families by name or brand…"
        collapsibleFilters
        activeFilterCount={status ? 1 : 0}
        filters={
          <FormSelect
            label="Family status filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </FormSelect>
        }
        actions={
          <>
            {canManage && (
              <Btn onClick={() => entry.open({ kind: 'family', category, divisionId })}>
                New family
              </Btn>
            )}
            <Btn variant="secondary" disabled={result.loading} onClick={result.reload}>
              Refresh families
            </Btn>
          </>
        }
      />
      {entry.drafts}
      <RecordBrowser<ProductFamily>
        stateKey={stateKey + '.record'}
        selectionScope={JSON.stringify(filters)}
        key={JSON.stringify(filters)}
        title="Product families"
        records={result.data?.data || []}
        name={familyLabel}
        reference={(r) => r.division?.name || r.divisionId || 'Company-wide'}
        status={(r) => (r.isActive ? 'ACTIVE' : 'INACTIVE')}
        fields={[
          { label: 'Selling price', value: (r) => catalogueMoney(r.defaultSellingPrice) },
          { label: 'Products', value: (r) => r.productCount ?? '—' },
        ]}
        details={[
          { label: 'Division', value: (r) => r.division?.name || r.divisionId || 'Company-wide' },
          { label: 'Purchase', value: (r) => catalogueMoney(r.defaultPurchasePrice) },
          { label: 'Wholesale', value: (r) => catalogueMoney(r.wholesalePrice) },
          { label: 'Retail', value: (r) => catalogueMoney(r.retailPrice) },
          { label: 'Inherited', value: (r) => r.inheritedPriceCount ?? '—' },
          { label: 'Overrides', value: (r) => r.overridePriceCount ?? '—' },
          { label: 'Missing prices', value: (r) => r.missingPriceCount ?? '—' },
          { label: 'Differing prices', value: (r) => r.priceExceptionCount ?? '—' },
          { label: 'Description', value: (r) => r.description || '—' },
        ]}
        loading={result.loading}
        error={result.error}
        onRetry={result.reload}
        total={result.data?.total || 0}
        page={page}
        onPage={setPage}
        pageSize={20}
        actions={(r) => (
          <>
            <Btn onClick={() => setReview(r)}>Review product prices</Btn>
            {canManage && (
              <Btn
                variant="secondary"
                onClick={() => entry.open({ kind: 'family', category, record: r, divisionId })}
              >
                Edit family
              </Btn>
            )}
          </>
        )}
      />
      {review && (
        <PriceReview category={category} family={review} onClose={() => setReview(null)} />
      )}
    </div>
  );
}

export function PriceReview({
  category,
  family,
  onClose,
}: {
  category: ProductCategory;
  family: ProductFamily;
  onClose: () => void;
}) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('products.view') || hasPermission('operations.dashboard.view');
  const products = useWorkspaceChoices<PriceReviewProduct>(
    '/products',
    { companyId: category.companyId, categoryId: category.id, productFamilyId: family.id },
    allowed,
  );
  const [page, setPage] = useState(1);
  const exceptions = products.rows.filter((p) => priceReviewReason(p, family));
  return (
    <Modal
      open
      title={`Price review · ${familyLabel(family)}`}
      size="lg"
      onClose={onClose}
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Close review
        </Btn>
      }
    >
      <div className="catalogue-price-review">
        <p className="catalogue-help">
          Family selling price: {catalogueMoney(family.defaultSellingPrice)}. Review differing
          prices, individual overrides and missing defaults across all products in this family.
        </p>
        {!allowed ? (
          <p>Product viewing permission is required.</p>
        ) : products.loading ? (
          <p role="status">Loading every product page…</p>
        ) : products.error ? (
          <p role="alert" className="workspace-notice">
            {products.error}{' '}
            <Btn
              variant="secondary"
              onClick={() => {
                setPage(1);
                products.retry();
              }}
            >
              Retry price review
            </Btn>
          </p>
        ) : (
          <>
            <p role="status" className="catalogue-help">
              Products to review: {exceptions.length} of {products.rows.length}.
            </p>
            {!exceptions.length && <p>No price exceptions found for this family.</p>}
            {exceptions.slice((page - 1) * 20, page * 20).map((p) => (
              <article key={p.id}>
                <h3>{p.name}</h3>
                <p className="catalogue-help">
                  {p.productCode || 'No code'} · {priceReviewReason(p, family)}
                </p>
                <dl>
                  <div>
                    <dt>Product selling price</dt>
                    <dd>{catalogueMoney(p.defaultSellingPrice)}</dd>
                  </div>
                  <div>
                    <dt>Effective selling price</dt>
                    <dd>{catalogueMoney(p.effectiveSellingPrice)}</dd>
                  </div>
                  <div>
                    <dt>Wholesale price</dt>
                    <dd>{catalogueMoney(p.wholesalePrice)}</dd>
                  </div>
                  <div>
                    <dt>Retail price</dt>
                    <dd>{catalogueMoney(p.retailPrice)}</dd>
                  </div>
                  <div>
                    <dt>Price source</dt>
                    <dd>{categoryTypeLabel(p.priceSource || 'MISSING')}</dd>
                  </div>
                </dl>
              </article>
            ))}
            {exceptions.length > 20 && (
              <div className="record-pagination">
                <span>
                  Page {page} of {Math.ceil(exceptions.length / 20)}
                </span>
                <Btn variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Btn>
                <Btn
                  variant="secondary"
                  disabled={page * 20 >= exceptions.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Btn>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
