'use client';
import type { ReactNode } from 'react';
import type { Catalog, Payload } from './types';
import { amount } from './types';

export function Section({
  number,
  title,
  detail,
  children,
}: {
  number?: string;
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section className="fr-section">
      <header className="fr-section-title">
        {number ? <span className="fr-step">{number}</span> : null}
        <div>
          <h2>{title}</h2>
          {detail ? <p>{detail}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}
export function Numeric({
  label,
  value,
  onChange,
  places = 2,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  places?: number;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      min="0"
      step={10 ** -places}
      inputMode="decimal"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      placeholder="Enter value"
    />
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="fr-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
type Props = { payload: Payload; catalog: Catalog; change: (payload: Payload) => void };
export function PumpReadings({ payload: p, catalog, change }: Props) {
  const update = (index: number, values: Partial<Payload['readings'][number]>) =>
    change({ ...p, readings: p.readings.map((r, i) => (i === index ? { ...r, ...values } : r)) });
  return (
    <Section
      number="01"
      title="Pumps & attendants"
      detail="Copy the paper meter readings. Enter a named attendant for every nozzle, including a nozzle with no sales."
    >
      {!catalog.nozzles.length ? (
        <p className="fr-notice">
          No pumps are configured for this branch. An admin must add them in Station setup.
        </p>
      ) : null}
      <div className="fr-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pump / fuel</th>
              <th>Attendant name</th>
              <th>Opening meter · L</th>
              <th>Closing meter · L</th>
              <th>Price · TZS/L</th>
              <th>Litres</th>
              <th>Sales · TZS</th>
              <th>
                <span className="sr-only">Interval actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {p.readings.map((r, i) => {
              const n = catalog.nozzles.find((n) => n.id === r.nozzleId);
              const litres = r.opening != null && r.closing != null ? r.closing - r.opening : null;
              const interval = p.readings.filter((x) => x.nozzleId === r.nozzleId).indexOf(r);
              return (
                <tr key={`${r.nozzleId}-${i}`}>
                  <td>
                    <strong>{n?.pumpName}</strong>
                    <small>
                      {n?.nozzleCode} · {n?.productName}
                      {interval > 0 ? ' · handover / price interval' : ''}
                    </small>
                  </td>
                  <td>
                    <input
                      aria-label={`Attendant ${n?.nozzleCode} interval ${interval + 1}`}
                      value={r.attendantName}
                      maxLength={160}
                      placeholder="Full name"
                      onChange={(e) => update(i, { attendantName: e.target.value })}
                    />
                  </td>
                  <td>
                    <Numeric
                      label={`Opening ${n?.nozzleCode} interval ${interval + 1}`}
                      value={r.opening}
                      places={3}
                      onChange={(opening) => update(i, { opening })}
                    />
                  </td>
                  <td>
                    <Numeric
                      label={`Closing ${n?.nozzleCode} interval ${interval + 1}`}
                      value={r.closing}
                      places={3}
                      onChange={(closing) => update(i, { closing })}
                    />
                  </td>
                  <td>
                    <Numeric
                      label={`Price ${n?.nozzleCode} interval ${interval + 1}`}
                      value={r.price}
                      places={4}
                      onChange={(price) => update(i, { price })}
                    />
                  </td>
                  <td className={litres != null && litres < 0 ? 'fr-negative' : 'fr-number'}>
                    {amount(litres, 3)}
                  </td>
                  <td className="fr-number">
                    {amount(litres != null && r.price != null ? litres * r.price : null)}
                  </td>
                  <td>
                    {interval > 0 ? (
                      <button
                        type="button"
                        className="fr-text-button"
                        onClick={() =>
                          change({ ...p, readings: p.readings.filter((_, index) => index !== i) })
                        }
                      >
                        Remove interval
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="fr-text-button"
                        onClick={() => {
                          const rows = [...p.readings];
                          const last = rows.findLastIndex((x) => x.nozzleId === r.nozzleId);
                          rows.splice(last + 1, 0, {
                            ...rows[last],
                            opening: rows[last].closing,
                            closing: null,
                            attendantName: '',
                          });
                          change({ ...p, readings: rows });
                        }}
                      >
                        Add handover / price interval
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
export function Collections({ payload: p, change }: Omit<Props, 'catalog'>) {
  const labels = {
    cash: 'Cash sales collected',
    mobile: 'Mobile money collected',
    bank: 'Bank / card collected',
    openingCash: 'Opening cash float',
    cashHandedOver: 'Cash handed over',
  };
  return (
    <Section
      number="02"
      title="Collections & credit sales"
      detail="Enter TZS amounts. Cash sales collected is the gross cash received, before paying expenses or suppliers. Enter 0 when none."
    >
      <div className="fr-grid">
        {Object.entries(labels).map(([key, label]) => (
          <Field key={key} label={label}>
            <Numeric
              label={label}
              value={p.collections[key as keyof typeof labels]}
              onChange={(value) =>
                change({ ...p, collections: { ...p.collections, [key]: value } })
              }
            />
          </Field>
        ))}
      </div>
      <h3 className="fr-subtitle">Credit sales</h3>
      {p.creditSales.map((r, i) => (
        <div className="fr-entry" key={i}>
          <Field label="Customer">
            <input
              value={r.customer}
              maxLength={160}
              onChange={(e) =>
                change({
                  ...p,
                  creditSales: p.creditSales.map((x, index) =>
                    index === i ? { ...x, customer: e.target.value } : x,
                  ),
                })
              }
            />
          </Field>
          <Field label="Reference / vehicle">
            <input
              value={r.reference}
              maxLength={160}
              onChange={(e) =>
                change({
                  ...p,
                  creditSales: p.creditSales.map((x, index) =>
                    index === i ? { ...x, reference: e.target.value } : x,
                  ),
                })
              }
            />
          </Field>
          <Field label="Credit amount · TZS">
            <Numeric
              label={`Credit amount ${i + 1}`}
              value={r.amount}
              onChange={(amount) =>
                change({
                  ...p,
                  creditSales: p.creditSales.map((x, index) =>
                    index === i ? { ...x, amount: amount ?? 0 } : x,
                  ),
                })
              }
            />
          </Field>
          <button
            type="button"
            className="fr-text-button"
            onClick={() =>
              change({ ...p, creditSales: p.creditSales.filter((_, index) => i !== index) })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="fr-secondary"
        onClick={() =>
          change({
            ...p,
            creditSales: [...p.creditSales, { customer: '', reference: '', amount: 0 }],
          })
        }
      >
        + Add credit sale
      </button>
    </Section>
  );
}
export function FuelReceived({ payload: p, catalog, change }: Props) {
  const products = [
    ...new Map(
      catalog.tanks.map((t) => [t.productId, { id: t.productId, name: t.productName }]),
    ).values(),
  ];
  const update = (i: number, values: Partial<Payload['deliveries'][number]>) =>
    change({
      ...p,
      deliveries: p.deliveries.map((r, index) => (index === i ? { ...r, ...values } : r)),
    });
  return (
    <Section
      number="03"
      title="Fuel received"
      detail="Record each delivery by fuel type and litres. Supplier details and purchase cost are optional; no receiving tank is needed."
    >
      {p.deliveries.length === 0 ? (
        <p className="fr-empty">No deliveries entered for this shift.</p>
      ) : null}
      {p.deliveries.map((r, i) => (
        <div className="fr-delivery" key={i}>
          <div className="fr-entry-heading">
            <h3>Delivery {i + 1}</h3>
            <button
              type="button"
              className="fr-text-button"
              onClick={() =>
                change({ ...p, deliveries: p.deliveries.filter((_, index) => index !== i) })
              }
            >
              Remove delivery
            </button>
          </div>
          <div className="fr-grid">
            <Field label="Fuel type">
              <select
                value={r.productId}
                onChange={(e) => update(i, { productId: e.target.value })}
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Litres received">
              <Numeric
                label={`Litres received ${i + 1}`}
                places={3}
                value={r.litres}
                onChange={(litres) => update(i, { litres: litres ?? 0 })}
              />
            </Field>
            <Field label="Supplier · optional">
              <input
                value={r.supplier}
                maxLength={160}
                onChange={(e) => update(i, { supplier: e.target.value })}
              />
            </Field>
            <Field label="Delivery / invoice reference · optional">
              <input
                value={r.reference}
                maxLength={160}
                onChange={(e) => update(i, { reference: e.target.value })}
              />
            </Field>
            <Field label="Total purchase cost · optional">
              <Numeric
                label={`Purchase cost ${i + 1}`}
                value={r.totalCost}
                onChange={(totalCost) => update(i, { totalCost })}
              />
            </Field>
            <Field label="Amount paid to supplier · TZS">
              <Numeric
                label={`Supplier payment ${i + 1}`}
                value={r.paidAmount}
                onChange={(paidAmount) => update(i, { paidAmount: paidAmount ?? 0 })}
              />
            </Field>
            <Field label="Payment source">
              <select
                value={r.paymentSource}
                onChange={(e) => update(i, { paymentSource: e.target.value })}
              >
                <option value="OTHER">Other account / unpaid</option>
                <option value="SHIFT_CASH">This shift’s cash</option>
              </select>
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="fr-secondary"
        disabled={!products.length}
        onClick={() =>
          change({
            ...p,
            receiptsConfirmed: false,
            deliveries: [
              ...p.deliveries,
              {
                productId: products[0].id,
                litres: 0,
                supplier: '',
                reference: '',
                totalCost: null,
                paidAmount: 0,
                paymentSource: 'OTHER',
              },
            ],
          })
        }
      >
        + Receive fuel
      </button>
      <label className="fr-check">
        <input
          type="checkbox"
          checked={p.receiptsConfirmed}
          onChange={(e) => change({ ...p, receiptsConfirmed: e.target.checked })}
        />
        {p.deliveries.length
          ? 'All fuel received during this shift has been recorded.'
          : 'I confirm no fuel was received during this shift.'}
      </label>
    </Section>
  );
}
export function Expenses({ payload: p, change }: Omit<Props, 'catalog'>) {
  const update = (i: number, values: Partial<Payload['expenses'][number]>) =>
    change({
      ...p,
      expenses: p.expenses.map((r, index) => (index === i ? { ...r, ...values } : r)),
    });
  return (
    <Section
      number="04"
      title="Expenses"
      detail="Only expenses paid from this shift’s cash reduce the expected cash handover."
    >
      {p.expenses.length === 0 ? (
        <p className="fr-empty">No expenses entered for this shift.</p>
      ) : null}
      {p.expenses.map((r, i) => (
        <div className="fr-entry" key={i}>
          <Field label="Category">
            <input
              list="fr-expense-categories"
              value={r.category}
              maxLength={100}
              onChange={(e) => update(i, { category: e.target.value })}
            />
          </Field>
          <Field label="Description / paid to">
            <input
              value={r.description}
              maxLength={500}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </Field>
          <Field label="Amount · TZS">
            <Numeric
              label={`Expense amount ${i + 1}`}
              value={r.amount}
              onChange={(amount) => update(i, { amount: amount ?? 0 })}
            />
          </Field>
          <Field label="Payment source">
            <select
              value={r.paymentSource}
              onChange={(e) => update(i, { paymentSource: e.target.value })}
            >
              <option value="SHIFT_CASH">This shift’s cash</option>
              <option value="OTHER">Other account</option>
            </select>
          </Field>
          <button
            type="button"
            className="fr-text-button"
            onClick={() => change({ ...p, expenses: p.expenses.filter((_, index) => index !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <datalist id="fr-expense-categories">
        {['Transport', 'Maintenance', 'Utilities', 'Staff meals', 'Station supplies', 'Other'].map(
          (x) => (
            <option key={x} value={x} />
          ),
        )}
      </datalist>
      <button
        type="button"
        className="fr-secondary"
        onClick={() =>
          change({
            ...p,
            expensesConfirmed: false,
            expenses: [
              ...p.expenses,
              { category: '', description: '', amount: 0, paymentSource: 'SHIFT_CASH' },
            ],
          })
        }
      >
        + Add expense
      </button>
      <label className="fr-check">
        <input
          type="checkbox"
          checked={p.expensesConfirmed}
          onChange={(e) => change({ ...p, expensesConfirmed: e.target.checked })}
        />
        {p.expenses.length
          ? 'All shift expenses have been recorded.'
          : 'I confirm there were no expenses during this shift.'}
      </label>
    </Section>
  );
}
export function TankDips({ payload: p, catalog, change }: Props) {
  return (
    <Section
      number="05"
      title="Closing tank dips"
      detail="Required to close the shift. Copy each measured volume in litres from the paper dip record. A blank reading is not zero."
    >
      <div className="fr-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Tank</th>
              <th>Fuel type</th>
              <th>Opening volume · L</th>
              <th>Closing measured volume · L</th>
            </tr>
          </thead>
          <tbody>
            {catalog.tanks.map((t) => {
              const dip = p.dips.find((d) => d.tankId === t.id);
              const update = (values: Partial<Payload['dips'][number]>) =>
                change({
                  ...p,
                  dips: p.dips.map((d) => (d.tankId === t.id ? { ...d, ...values } : d)),
                });
              return (
                <tr key={t.id}>
                  <td>
                    <strong>{t.tankName}</strong>
                    <small>Capacity {amount(t.capacityLitres, 0)} L</small>
                  </td>
                  <td>{t.productName}</td>
                  <td>
                    <Numeric
                      label={`Opening dip ${t.tankName}`}
                      value={dip?.opening ?? null}
                      places={3}
                      onChange={(opening) => update({ opening })}
                    />
                  </td>
                  <td>
                    <Numeric
                      label={`Closing dip ${t.tankName}`}
                      value={dip?.closing ?? null}
                      places={3}
                      onChange={(closing) => update({ closing })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
