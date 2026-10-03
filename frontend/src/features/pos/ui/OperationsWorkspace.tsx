'use client';

import { useEffect, useMemo, useState } from 'react';
import { Package, Truck, ClipboardCheck } from 'lucide-react';
import { usePosStock } from '../core/hooks/use-pos-stock';
import type { PosShellProps } from './PosShell';
import type { PosStep } from './use-pos-step';
import { StockWorkspace } from './StockWorkspace';
import { ReceivingWorkspace, DeliveryHistory } from './ReceivingWorkspace';
import { StockCountWorkspace } from './StockCountWorkspace';
import { DailyReports } from './DailyReports';

export type OperationsProps = {
  props: PosShellProps;
  step: PosStep;
  go: (step: PosStep) => void;
  onBusy: (busy: boolean) => void;
};

/** Draft hooks remain mounted across Sell/Stock navigation in the controlling
 * instance. Read-only instances never mount a writer to the terminal draft. */
export function OperationsWorkspace({ props, step, go, onBusy }: OperationsProps) {
  const stock = usePosStock({ binding: props.binding });
  const ensureFresh = stock.ensureFresh;
  const [receivingBusy, setReceivingBusy] = useState(false);
  const [countBusy, setCountBusy] = useState(false);
  const active = ['stock', 'counts', 'receiving', 'deliveries', 'reports'].includes(step);
  const owned = props.control?.owned ?? true;
  const allowed =
    (step !== 'counts' || props.session.stockCountsEnabled) &&
    (!['receiving', 'deliveries'].includes(step) || props.session.purchasesEnabled);
  const visibleProducts = useMemo(
    () =>
      stock.snapshot
        ? new Map(stock.snapshot.items.map((item) => [item.productId, item.name]))
        : null,
    [stock.snapshot],
  );
  useEffect(() => {
    onBusy(receivingBusy || countBusy);
  }, [receivingBusy, countBusy, onBusy]);
  useEffect(() => {
    if (active && step !== 'reports') ensureFresh();
  }, [active, step, ensureFresh]);
  return (
    <div hidden={!active} className="pos-operations">
      {active && (
        <nav className="pos-operation-tabs" aria-label={props.t('posStockWorkspace')}>
          <button
            type="button"
            aria-current={step === 'stock' ? 'page' : undefined}
            onClick={() => go('stock')}
          >
            <Package size={17} aria-hidden="true" />
            {props.t('posStockTab')}
          </button>
          {props.session.purchasesEnabled && (
            <>
              <button
                type="button"
                aria-current={step === 'receiving' ? 'page' : undefined}
                onClick={() => go('receiving')}
              >
                <Truck size={17} aria-hidden="true" />
                {props.t('posReceiveStock')}
              </button>
              <button
                type="button"
                aria-current={step === 'deliveries' ? 'page' : undefined}
                onClick={() => go('deliveries')}
              >
                {props.t('posDeliveryHistory')}
              </button>
            </>
          )}
          {props.session.stockCountsEnabled && (
            <button
              type="button"
              aria-current={step === 'counts' ? 'page' : undefined}
              onClick={() => go('counts')}
            >
              <ClipboardCheck size={17} aria-hidden="true" />
              {props.t('countTitle')}
            </button>
          )}
        </nav>
      )}
      {!allowed && (
        <p className="pos-note" data-tone="warn" role="alert">
          {props.t('posOperationUnavailable')}
        </p>
      )}
      <div hidden={step !== 'stock'}>
        <StockWorkspace {...stock} props={props} go={go} active={step === 'stock'} />
      </div>
      {props.session.purchasesEnabled && owned && (
        <div hidden={step !== 'receiving'}>
          <ReceivingWorkspace
            props={props}
            active={step === 'receiving'}
            onBusy={setReceivingBusy}
            onReceived={stock.refresh}
            go={go}
          />
        </div>
      )}
      {props.session.stockCountsEnabled && owned && (
        <div hidden={step !== 'counts'}>
          <StockCountWorkspace
            props={props}
            active={step === 'counts'}
            stock={stock}
            visibleProducts={visibleProducts}
            onBusy={setCountBusy}
          />
        </div>
      )}
      {allowed && ['receiving', 'counts'].includes(step) && !owned && (
        <p className="pos-note" data-tone="warn">
          {props.t('posOperationControl')}
        </p>
      )}
      {props.session.purchasesEnabled && step === 'deliveries' && <DeliveryHistory props={props} />}
      {step === 'reports' && <DailyReports props={props} />}
    </div>
  );
}
