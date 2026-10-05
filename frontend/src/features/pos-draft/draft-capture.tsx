'use client';
import { useRef, useState } from 'react';
import { Plus, ScanLine, Trash2 } from 'lucide-react';
import { useScanner } from '@/features/pos/hardware/scanner';
import type {
  Draft,
  DraftContext,
  DraftKind,
  DraftLine,
  DraftPayload,
  LocalAcknowledgement,
  PaymentMethod,
  PosRole,
  Submission,
} from './types';
import { businessDate, KIND_LABELS, money } from './types';

type CaptureLine = {
  productId: string;
  quantity: string;
  price: string;
};
const DAMAGE_TYPES = [
  'BREAKAGE',
  'EXPIRED',
  'SPOILED',
  'LOST',
  'THEFT',
  'DAMAGED_PACKAGING',
  'OTHER',
];
const PAYMENT_LABELS = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
};
export function allowedKinds(role: PosRole, context: DraftContext): DraftKind[] {
  const kinds: DraftKind[] = context.capabilities.canSubmitSale ? ['SALE', 'COLLECTION'] : [];
  if (role !== 'CASHIER' && context.capabilities.canSubmitStock)
    kinds.push('RECEIPT', 'TRANSFER', 'COUNT', 'DAMAGE');
  return kinds;
}
export function DraftCapture<Result extends Draft | LocalAcknowledgement>({
  context,
  role,
  send,
  onSaved,
  initial,
}: {
  context: DraftContext;
  role: PosRole;
  send: (body: Submission, initial?: Draft) => Promise<Result>;
  onSaved: (draft: Result) => void;
  initial?: Draft;
}) {
  const kinds = allowedKinds(role, context);
  const paymentMethods = context.paymentMethods ?? [];
  const [kind, setKind] = useState<DraftKind>(initial?.kind ?? kinds[0] ?? 'SALE');
  const [lines, setLines] = useState<CaptureLine[]>(
    () =>
      initial?.payload.lines?.map((line) => ({
        productId: line.productId,
        quantity: String(line.countedQuantity ?? line.quantity ?? 1),
        price: String(
          line.unitPrice ??
            context.products.find((p) => p.id === line.productId)?.sellingPrice ??
            '',
        ),
      })) ?? [],
  );
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState(initial?.payload.customerId ?? '');
  const [showCustomer, setShowCustomer] = useState(!!initial?.payload.customerId);
  const [method, setMethod] = useState<PaymentMethod>(
    initial?.payload.paymentMethod ?? initial?.payload.method ?? paymentMethods[0] ?? 'CASH',
  );
  const [reference, setReference] = useState(
    initial?.payload.paymentReference ?? initial?.payload.reference ?? '',
  );
  const [accountId, setAccountId] = useState(initial?.payload.cashAccountId ?? '');
  const [saleId, setSaleId] = useState(initial?.payload.salesOrderId ?? '');
  const [amount, setAmount] = useState(String(initial?.payload.amount ?? ''));
  const [purchaseId, setPurchaseId] = useState(initial?.payload.purchaseOrderId ?? '');
  const [fullOrderArrived, setFullOrderArrived] = useState(
    initial?.payload.fullOrderArrived === true,
  );
  const purchase = context.purchaseOrders.find((order) => order.id === purchaseId);
  const [destinationId, setDestinationId] = useState(initial?.payload.destinationBranchId ?? '');
  const [damageProduct, setDamageProduct] = useState(initial?.payload.productId ?? '');
  const [damageQuantity, setDamageQuantity] = useState(String(initial?.payload.quantity ?? ''));
  const [damageType, setDamageType] = useState(initial?.payload.damageType ?? 'BREAKAGE');
  const [reason, setReason] = useState(initial?.payload.reason ?? '');
  const [split, setSplit] = useState<
    Array<{ method: 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER'; amount: string; reference: string }>
  >(
    () =>
      initial?.payload.payments
        ?.filter((p) => p.method !== 'CREDIT')
        .map((p) => ({
          method: p.method as 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER',
          amount: String(p.amount),
          reference: p.reference ?? '',
        })) ?? [
        { method: paymentMethods[0] ?? 'CASH', amount: '', reference: '' },
        { method: paymentMethods[1] ?? paymentMethods[0] ?? 'CASH', amount: '', reference: '' },
      ],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const request = useRef(initial?.requestId ?? crypto.randomUUID());
  const capturedAt = useRef(initial?.capturedAt ?? new Date().toISOString());
  const form = useRef<HTMLFormElement>(null);
  const total = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.price), 0);
  const stockOnly = ['TRANSFER', 'COUNT'].includes(kind);
  const products = context.products.filter((p) =>
    kind === 'SALE' ? p.sellingPrice !== null : p.trackInventory,
  );
  const matches = products
    .filter((p) =>
      `${p.name} ${p.code ?? ''} ${p.barcode ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .slice(0, 12);
  function add(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setLines((current) =>
      current.some((line) => line.productId === productId)
        ? current.map((line) =>
            line.productId === productId
              ? { ...line, quantity: String(Number(line.quantity) + 1) }
              : line,
          )
        : [
            ...current,
            {
              productId,
              quantity: kind === 'COUNT' ? '' : '1',
              price: String(product.sellingPrice ?? ''),
            },
          ],
    );
    setSearch('');
    setReview(false);
  }
  useScanner(
    (code) => {
      const product = products.find(
        (p) =>
          p.barcode?.toLowerCase() === code.toLowerCase() ||
          p.code?.toLowerCase() === code.toLowerCase(),
      );
      if (product) add(product.id);
      else setError(`No product matches ${code}.`);
    },
    {
      enabled: !busy && !review && ['SALE', 'TRANSFER', 'COUNT'].includes(kind),
      acceptEvent: (target) => target instanceof Node && !!form.current?.contains(target),
    },
  );
  function patchLine(index: number, key: keyof CaptureLine, value: string) {
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, [key]: value } : line)),
    );
    setReview(false);
  }
  function makePayload(): DraftPayload {
    if (['SALE', 'TRANSFER', 'COUNT'].includes(kind) && !lines.length)
      throw new Error('Add at least one product.');
    const payloadLines: DraftLine[] = lines.map((line) => {
      const product = context.products.find((p) => p.id === line.productId);
      const quantity = Number(line.quantity);
      if (
        !product ||
        line.quantity === '' ||
        !Number.isFinite(quantity) ||
        (kind === 'COUNT' ? quantity < 0 : quantity <= 0)
      )
        throw new Error('Enter a valid quantity for every product.');
      if (kind === 'COUNT')
        return {
          productId: line.productId,
          countedQuantity: quantity,
          baselineQuantity: Number(product.quantityOnHand),
          physicalRevision: product.physicalRevision,
        };
      if (kind === 'TRANSFER') return { productId: line.productId, quantity };
      const price = Number(line.price);
      if (line.price === '' || !Number.isFinite(price) || price < 0)
        throw new Error('Enter a valid selling price.');
      return {
        productId: line.productId,
        quantity,
        unitPrice: price,
      };
    });
    if (kind === 'SALE') {
      if (
        method === 'CREDIT'
          ? !context.creditEnabled
          : method === 'MIXED'
            ? paymentMethods.length < 2
            : !paymentMethods.includes(method)
      )
        throw new Error('Choose a payment method configured for this branch.');
      if (method === 'CREDIT' && !customerId)
        throw new Error('Choose a customer for a credit sale.');
      if (['MOBILE_MONEY', 'BANK_TRANSFER'].includes(method) && !reference.trim())
        throw new Error('Enter the payment reference.');
      const payments =
        method === 'MIXED'
          ? split
              .filter((p) => Number(p.amount) > 0)
              .map((p) => ({
                method: p.method,
                amount: Number(p.amount),
                reference: p.reference.trim() || undefined,
              }))
          : undefined;
      if (
        payments &&
        (payments.length < 2 || Math.abs(payments.reduce((s, p) => s + p.amount, 0) - total) > 0.01)
      )
        throw new Error('Split payments must add up to the full sale total.');
      if (payments?.some((p) => p.method !== 'CASH' && !p.reference))
        throw new Error('Enter a reference for each electronic payment.');
      if (payments?.some((p) => !paymentMethods.includes(p.method)))
        throw new Error('Choose configured payment methods for each split.');
      return {
        customerId: customerId || undefined,
        paymentMethod: method,
        paymentReference: reference.trim() || undefined,
        cashAccountId: accountId || undefined,
        expectedTotal: total,
        lines: payloadLines,
        payments,
      };
    }
    if (kind === 'COLLECTION') {
      if (!saleId || !Number.isFinite(Number(amount)) || Number(amount) <= 0)
        throw new Error('Choose the unpaid sale and enter a positive amount.');
      if (['CREDIT', 'MIXED'].includes(method))
        throw new Error('Choose a collection payment method.');
      if (!paymentMethods.includes(method as 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER'))
        throw new Error('Choose a collection method configured for this branch.');
      if (method !== 'CASH' && !reference.trim())
        throw new Error('Enter the collection reference.');
      return {
        salesOrderId: saleId,
        amount: Number(amount),
        method: method as 'CASH' | 'MOBILE_MONEY' | 'BANK_TRANSFER',
        reference: reference.trim() || undefined,
        cashAccountId: accountId || undefined,
      };
    }
    if (kind === 'RECEIPT') {
      if (!purchase) throw new Error('Choose a confirmed purchase order.');
      if (!fullOrderArrived) throw new Error('Confirm that every item in the order has arrived.');
      return { purchaseOrderId: purchaseId, fullOrderArrived: true };
    }
    if (kind === 'TRANSFER') {
      if (!destinationId || destinationId === context.scope.branchId)
        throw new Error('Choose another destination branch.');
      return { destinationBranchId: destinationId, lines: payloadLines };
    }
    if (kind === 'COUNT') return { lines: payloadLines };
    if (
      !damageProduct ||
      !reason.trim() ||
      !Number.isFinite(Number(damageQuantity)) ||
      Number(damageQuantity) <= 0
    )
      throw new Error('Choose the product, quantity and reason for the damage.');
    return {
      productId: damageProduct,
      quantity: Number(damageQuantity),
      damageType,
      reason: reason.trim(),
    };
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      const payload = makePayload();
      if (kind !== 'SALE' && !review) {
        setReview(true);
        return;
      }
      setBusy(true);
      const draft = await send(
        {
          companyId: context.scope.companyId,
          divisionId: context.scope.divisionId,
          branchId: context.scope.branchId,
          requestId: request.current,
          capturedAt: capturedAt.current,
          businessDate: initial?.businessDate ?? businessDate(capturedAt.current),
          kind,
          payload,
        },
        initial,
      );
      onSaved(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit this request.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={form} className="pd-capture" onSubmit={submit}>
      <div className="pd-section-heading">
        <div>
          <h2>
            {initial
              ? 'Correct request'
              : role === 'STOCKIST' && kind === 'SALE'
                ? 'Dispatch sale'
                : 'New request'}
          </h2>
          <p>
            {role === 'ADMIN'
              ? 'Capture the business details, then review before posting.'
              : 'Submit for approval. Money and stock remain pending until posted.'}
          </p>
        </div>
        <ScanLine size={20} aria-hidden="true" />
      </div>
      {!initial && (
        <div className="pd-kind-picker" aria-label="Request type">
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === kind}
              onClick={() => {
                setKind(value);
                setLines([]);
                setReview(false);
                setError('');
                request.current = crypto.randomUUID();
                capturedAt.current = new Date().toISOString();
              }}
            >
              {KIND_LABELS[value]}
            </button>
          ))}
        </div>
      )}
      {['SALE', 'TRANSFER', 'COUNT'].includes(kind) && (
        <>
          <label className="pd-field">
            Find a product
            <input
              value={search}
              placeholder="Name or barcode"
              onChange={(e) => {
                setSearch(e.target.value);
                setReview(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search && matches.length === 1) {
                  e.preventDefault();
                  add(matches[0].id);
                }
              }}
            />
          </label>
          <div className="pd-product-picker">
            {matches.map((product) => (
              <button type="button" key={product.id} onClick={() => add(product.id)}>
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {stockOnly
                      ? `${product.quantityOnHand} ${product.unitSymbol} in stock`
                      : money(product.sellingPrice)}
                  </small>
                </span>
                <Plus size={17} aria-hidden="true" />
              </button>
            ))}
          </div>
          {lines.map((line, index) => {
            const product = context.products.find((p) => p.id === line.productId);
            return (
              <div className="pd-capture-line" key={line.productId}>
                <div className="pd-line-title">
                  <strong>{product?.name ?? line.productId}</strong>
                  <button
                    type="button"
                    className="pd-icon-button"
                    aria-label={`Remove ${product?.name ?? 'product'}`}
                    onClick={() => {
                      setLines((current) => current.filter((_, i) => i !== index));
                      setReview(false);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="pd-form-grid">
                  <label className="pd-field">
                    {kind === 'COUNT' ? 'Counted quantity' : 'Quantity'}
                    <input
                      type="number"
                      min={kind === 'COUNT' ? 0 : 0.001}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => patchLine(index, 'quantity', e.target.value)}
                    />
                  </label>
                  {kind === 'SALE' && (
                    <label className="pd-field">
                      Unit price
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.price}
                        onChange={(e) => patchLine(index, 'price', e.target.value)}
                      />
                    </label>
                  )}
                </div>
                {kind === 'COUNT' && (
                  <p className="pd-muted">
                    Baseline: {product?.quantityOnHand} {product?.unitSymbol}. Variance:{' '}
                    {line.quantity === ''
                      ? '—'
                      : Number(line.quantity) - Number(product?.quantityOnHand)}
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}
      {kind === 'SALE' && !showCustomer && method !== 'CREDIT' && (
        <button type="button" className="pd-button" onClick={() => setShowCustomer(true)}>
          Choose customer · optional
        </button>
      )}
      {kind === 'SALE' && (showCustomer || method === 'CREDIT') && (
        <label className="pd-field">
          Customer {method !== 'CREDIT' && <span className="pd-muted">· optional</span>}
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setReview(false);
            }}
          >
            <option value="">Walk-in customer</option>
            {context.customers.map((customer) => (
              <option value={customer.id} key={customer.id}>
                {customer.name}
                {customer.customerCode ? ` · ${customer.customerCode}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'COLLECTION' && (
        <>
          <label className="pd-field">
            Unpaid sale
            <select
              value={saleId}
              onChange={(e) => {
                setSaleId(e.target.value);
                setReview(false);
              }}
            >
              <option value="">Choose a sale</option>
              {context.unpaidSales.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  {sale.salesOrderNumber} · {sale.customerName} · {money(sale.outstandingAmount)}
                </option>
              ))}
            </select>
          </label>
          <label className="pd-field">
            Amount received
            <input
              type="number"
              min="0.01"
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setReview(false);
              }}
            />
          </label>
        </>
      )}
      {['SALE', 'COLLECTION'].includes(kind) && (
        <>
          <div className="pd-form-grid">
            <label className="pd-field">
              Payment method
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value as PaymentMethod);
                  setReview(false);
                }}
              >
                {paymentMethods.map((value) => (
                  <option key={value} value={value}>
                    {PAYMENT_LABELS[value]}
                  </option>
                ))}
                {kind === 'SALE' && (
                  <>
                    {context.creditEnabled && <option value="CREDIT">Credit</option>}
                    {paymentMethods.length > 1 && <option value="MIXED">Split payment</option>}
                  </>
                )}
              </select>
            </label>
            {['MOBILE_MONEY', 'BANK_TRANSFER'].includes(method) && (
              <label className="pd-field">
                Payment reference
                <input
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setReview(false);
                  }}
                />
              </label>
            )}
          </div>
          {method === 'MIXED' &&
            split.map((payment, index) => (
              <div className="pd-form-grid" key={index}>
                <label className="pd-field">
                  Payment {index + 1}
                  <select
                    value={payment.method}
                    onChange={(e) => {
                      setSplit((current) =>
                        current.map((p, at) =>
                          at === index
                            ? { ...p, method: e.target.value as typeof payment.method }
                            : p,
                        ),
                      );
                      setReview(false);
                    }}
                  >
                    {paymentMethods.map((value) => (
                      <option key={value} value={value}>
                        {PAYMENT_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pd-field">
                  Amount
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={payment.amount}
                    onChange={(e) => {
                      setSplit((current) =>
                        current.map((p, at) =>
                          at === index ? { ...p, amount: e.target.value } : p,
                        ),
                      );
                      setReview(false);
                    }}
                  />
                </label>
                {payment.method !== 'CASH' && (
                  <label className="pd-field">
                    Reference
                    <input
                      value={payment.reference}
                      onChange={(e) => {
                        setSplit((current) =>
                          current.map((p, at) =>
                            at === index ? { ...p, reference: e.target.value } : p,
                          ),
                        );
                        setReview(false);
                      }}
                    />
                  </label>
                )}
              </div>
            ))}
          {role === 'ADMIN' && method !== 'CREDIT' && (
            <label className="pd-field">
              Receipt account
              <select
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setReview(false);
                }}
              >
                <option value="">Branch default</option>
                {context.accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.accountName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {kind === 'RECEIPT' && (
        <>
          <label className="pd-field">
            Confirmed purchase order
            <select
              value={purchaseId}
              onChange={(e) => {
                setPurchaseId(e.target.value);
                setFullOrderArrived(false);
                setReview(false);
              }}
            >
              <option value="">Choose a purchase order</option>
              {context.purchaseOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.purchaseOrderNumber} · {order.supplierName}
                </option>
              ))}
            </select>
          </label>
          {purchase && (
            <section className="pd-order-review" aria-label="Purchase order to receive">
              <h3>{purchase.purchaseOrderNumber}</h3>
              <p>
                Supplier · <strong>{purchase.supplierName}</strong>
              </p>
              <div className="pd-detail-lines">
                {purchase.lines.map((line) => (
                  <div key={line.productId}>
                    <strong>{line.name}</strong>
                    <span>
                      {line.quantity} × {money(line.unitCost, purchase.currency)}
                    </span>
                    <small>{money(line.lineTotal, purchase.currency)}</small>
                  </div>
                ))}
              </div>
              <div className="pd-capture-total">
                <span>Order total</span>
                <strong>{money(purchase.totalAmount, purchase.currency)}</strong>
              </div>
              <p className="pd-muted">
                {purchase.purchaseType.toLowerCase().replaceAll('_', ' ')}
                {purchase.paymentTerms ? ` · ${purchase.paymentTerms}` : ''}
              </p>
              <label className="pd-check">
                <input
                  type="checkbox"
                  checked={fullOrderArrived}
                  onChange={(event) => {
                    setFullOrderArrived(event.target.checked);
                    setReview(false);
                  }}
                />
                <span>Every item and the full quantity shown above have arrived.</span>
              </label>
            </section>
          )}
          <p className="pd-muted">
            This request receives the full confirmed order. The receipt is created after approval.
          </p>
        </>
      )}
      {kind === 'TRANSFER' && (
        <label className="pd-field">
          Destination branch
          <select
            value={destinationId}
            onChange={(e) => {
              setDestinationId(e.target.value);
              setReview(false);
            }}
          >
            <option value="">Choose a branch</option>
            {context.branches
              .filter((branch) => branch.id !== context.scope.branchId)
              .map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {kind === 'DAMAGE' && (
        <>
          <label className="pd-field">
            Product
            <select
              value={damageProduct}
              onChange={(e) => {
                setDamageProduct(e.target.value);
                setReview(false);
              }}
            >
              <option value="">Choose a product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <div className="pd-form-grid">
            <label className="pd-field">
              Damaged quantity
              <input
                type="number"
                min="0.001"
                step="any"
                value={damageQuantity}
                onChange={(e) => {
                  setDamageQuantity(e.target.value);
                  setReview(false);
                }}
              />
            </label>
            <label className="pd-field">
              Damage type
              <select
                value={damageType}
                onChange={(e) => {
                  setDamageType(e.target.value);
                  setReview(false);
                }}
              >
                {DAMAGE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value.toLowerCase().replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="pd-field">
            Reason
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReview(false);
              }}
              rows={3}
            />
          </label>
        </>
      )}
      {kind === 'SALE' && (
        <div className="pd-capture-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
      )}
      {review && (
        <p className="pd-notice" role="status">
          Review these details. Submitting creates a pending request; it does not finalize money or
          stock.
        </p>
      )}
      {error && (
        <p className="pd-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="pd-button pd-primary"
        disabled={busy || !kinds.includes(kind)}
        type="submit"
      >
        {busy
          ? 'Submitting…'
          : kind === 'SALE'
            ? initial
              ? 'Submit correction'
              : 'Submit sale for review'
            : review
              ? initial
                ? 'Submit correction'
                : 'Submit request'
              : 'Review request'}
      </button>
    </form>
  );
}
