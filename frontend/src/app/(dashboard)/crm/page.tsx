'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface CRMSummary {
  totalCustomers: number;
  totalSuppliers: number;
  openCommunications: number;
  followUpsDue: number;
  highRiskCreditProfiles: number;
  supplierRiskProfiles: number;
  customerOutstanding: number;
  supplierOutstanding: number;
}

export default function CRMDashboardPage() {
  const [stats, setStats] = useState<CRMSummary>({
    totalCustomers: 0,
    totalSuppliers: 0,
    openCommunications: 0,
    followUpsDue: 0,
    highRiskCreditProfiles: 0,
    supplierRiskProfiles: 0,
    customerOutstanding: 0,
    supplierOutstanding: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/crm/summary')
      .then((r) => r.json())
      .then((res) => {
        const d = res.data ?? res;
        setStats({
          totalCustomers: d.totalCustomers ?? 0,
          totalSuppliers: d.totalSuppliers ?? 0,
          openCommunications: d.openCommunications ?? 0,
          followUpsDue: d.relationshipOps?.followUpsDue ?? 0,
          highRiskCreditProfiles: d.relationshipOps?.highRiskCreditProfiles ?? 0,
          supplierRiskProfiles: d.relationshipOps?.supplierRiskProfiles ?? 0,
          customerOutstanding: d.customers?.outstandingBalance ?? 0,
          supplierOutstanding: d.suppliers?.outstandingBalance ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    {
      label: 'Total Customers',
      value: stats.totalCustomers,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Total Suppliers',
      value: stats.totalSuppliers,
      color: 'bg-green-50 text-green-700 border-green-200',
    },
    {
      label: 'Open Communications',
      value: stats.openCommunications,
      color: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    },
    {
      label: 'Follow-Ups Due',
      value: stats.followUpsDue,
      color: 'bg-red-50 text-red-700 border-red-200',
    },
  ];

  const relationshipCards = [
    { label: 'High-Risk Credit Profiles', value: stats.highRiskCreditProfiles },
    { label: 'Supplier Risk Profiles', value: stats.supplierRiskProfiles },
    { label: 'Customer Outstanding', value: formatMoney(stats.customerOutstanding) },
    { label: 'Supplier Outstanding', value: formatMoney(stats.supplierOutstanding) },
  ];

  const quickLinks = [
    {
      label: 'Contact Persons',
      href: '/crm/contact-persons',
      desc: 'Manage customer and supplier contacts',
    },
    {
      label: 'Communication Logs',
      href: '/crm/communication-logs',
      desc: 'Track all communications',
    },
    { label: 'Credit Profiles', href: '/crm/credit-profiles', desc: 'Customer credit management' },
    {
      label: 'Supplier Performance',
      href: '/crm/supplier-performance',
      desc: 'Evaluate supplier performance',
    },
    {
      label: 'Customer Segments',
      href: '/crm/customer-segments',
      desc: 'Manage customer segmentation',
    },
    {
      label: 'Customer Statements',
      href: '/crm/customer-statements',
      desc: 'Customer account statements',
    },
    {
      label: 'Supplier Statements',
      href: '/crm/supplier-statements',
      desc: 'Supplier account statements',
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">CRM / SRM</h1>
        <p className="text-gray-500 mt-1">Customer and supplier relationship management overview</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {relationshipCards.map((card) => (
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

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}
