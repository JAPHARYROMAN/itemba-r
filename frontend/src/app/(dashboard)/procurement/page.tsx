'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ProcurementSummary {
  openRequisitions: number;
  pendingRfqs: number;
  pendingGrns: number;
  pendingInvoices: number;
  overdueRequisitions: number;
  overduePurchaseOrders: number;
  committedAmount: number;
  invoiceOutstandingAmount: number;
  threeWayMatchVariances: number;
}

export default function ProcurementDashboardPage() {
  const [stats, setStats] = useState<ProcurementSummary>({
    openRequisitions: 0,
    pendingRfqs: 0,
    pendingGrns: 0,
    pendingInvoices: 0,
    overdueRequisitions: 0,
    overduePurchaseOrders: 0,
    committedAmount: 0,
    invoiceOutstandingAmount: 0,
    threeWayMatchVariances: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/procurement/summary')
      .then((r) => r.json())
      .then((res) => {
        const d = res.data ?? res;
        setStats({
          openRequisitions: d.openRequisitions ?? 0,
          pendingRfqs: d.pendingRfqs ?? 0,
          pendingGrns: d.pendingGrns ?? 0,
          pendingInvoices: d.pendingInvoices ?? 0,
          overdueRequisitions: d.requisitions?.overdue ?? 0,
          overduePurchaseOrders: d.purchaseOrders?.overdue ?? 0,
          committedAmount: d.purchaseOrders?.committedAmount ?? 0,
          invoiceOutstandingAmount: d.invoices?.outstandingAmount ?? 0,
          threeWayMatchVariances: d.receiving?.threeWayMatchVariances ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'Open Requisitions',
      value: stats.openRequisitions,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Pending RFQs',
      value: stats.pendingRfqs,
      color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    },
    {
      label: 'Pending GRNs',
      value: stats.pendingGrns,
      color: 'bg-orange-50 text-orange-700 border-orange-200',
    },
    {
      label: 'Pending Invoices',
      value: stats.pendingInvoices,
      color: 'bg-red-50 text-red-700 border-red-200',
    },
  ];

  const controlCards = [
    { label: 'Overdue Requisitions', value: stats.overdueRequisitions },
    { label: 'Overdue POs', value: stats.overduePurchaseOrders },
    { label: '3-Way Variances', value: stats.threeWayMatchVariances },
    { label: 'Committed Spend', value: formatMoney(stats.committedAmount) },
    { label: 'Invoice Outstanding', value: formatMoney(stats.invoiceOutstandingAmount) },
  ];

  const quickLinks = [
    {
      label: 'Purchase Requisitions',
      href: '/procurement/requisitions',
      desc: 'Manage purchase requests',
    },
    { label: 'Requests for Quotation', href: '/procurement/rfqs', desc: 'RFQs sent to suppliers' },
    {
      label: 'Supplier Quotations',
      href: '/procurement/supplier-quotations',
      desc: 'Quotes received from suppliers',
    },
    {
      label: 'Bid Comparisons',
      href: '/procurement/bid-comparisons',
      desc: 'Compare supplier bids',
    },
    { label: 'Goods Received Notes', href: '/procurement/grns', desc: 'Record goods receipts' },
    {
      label: 'Supplier Invoices',
      href: '/procurement/supplier-invoices',
      desc: 'Process supplier invoices',
    },
    {
      label: 'Three-Way Matching',
      href: '/procurement/three-way-matching',
      desc: 'PO, GRN, invoice matching',
    },
    { label: 'Procurement Plans', href: '/procurement/plans', desc: 'Annual procurement planning' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Procurement</h1>
        <p className="text-gray-500 mt-1">End-to-end procurement management overview</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {controlCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xl font-semibold text-gray-900">{card.value}</div>
                <div className="text-xs text-gray-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="font-semibold text-gray-900 mb-1">{link.label}</div>
                <div className="text-sm text-gray-500">{link.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatMoney(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number.isFinite(num) ? num : 0);
}
