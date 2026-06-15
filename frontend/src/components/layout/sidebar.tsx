'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';

// ─── SVG Icon Components ──────────────────────────────────────────────────────
function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-4 h-4 flex-shrink-0 ${className}`}
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  dashboard: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  lock: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
  bank: 'M3 21h18M6 21V10m4 0v11m4-11v11m4 0V10M3 10l9-7 9 7',
  creditCard: 'M1 4h22v16H1zm5 8h3m2 0h3',
  fileText:
    'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8L14 2zm0 0v6h6M16 13H8m8 4H8m2-8H8',
  box: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  document:
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  clipboardList:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  building: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18zm-2 0H2m20 0h-4m-8-6h4m-4-4h4M10 6h4',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m22 0v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  barChart: 'M18 20V10m-6 10V4M6 20v-6',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zm0 0v3m0-3a3 3 0 000-6m0 0V6M6.34 17.66l-2.12 2.12M5.07 5.07 2.95 2.95m16.97 14.14 2.12 2.12M18.93 5.07l2.12-2.12',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  scale:
    'M12 3v1m0 16v1M5.636 5.636l.707.707m11.314 11.314.707.707M3 12h1m16 0h1M5.636 18.364l.707-.707m11.314-11.314.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z',
  // M11 icons
  checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  exclamationTriangle:
    'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  shieldCheck:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  // M12 icons
  trendingUp: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  pieChart:
    'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z',
  wrench:
    'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  lightBulb:
    'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  grid: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  server:
    'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
  bookmark: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  play: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  // M13 icons
  integration: 'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7',
  apiGateway: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  mobile: 'M17 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2zM12 18h.01',
  webhook:
    'M18 16.98h-5.99c-1.1 0-1.95.68-2.25 1.62M6.5 7h4M4 11h4M15 3l3 3-3 3M18 6H9a3 3 0 000 6',
  device: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
  sync: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  // M14 icons
  ShieldCheck:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  // M16 icons
  qa: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  launch:
    'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
  help2:
    'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  support2:
    'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
  // M14.5 icons
  accountingEngine:
    'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 6h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z',
  procurement:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  crm: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  docTemplate:
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  automation: 'M13 10V3L4 14h7v7l9-11h-7z',
  performance: 'M13 10V3L4 14h7v7l9-11h-7z',
  jobs: 'M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  isolation:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  deploy: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
  Database:
    'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  Activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  Archive:
    'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M10 12a1 1 0 102 0 1 1 0 00-2 0',
  CheckBadge:
    'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
};

// ─── Nav Structure ────────────────────────────────────────────────────────────
export type NavLeaf = {
  href: string;
  label: string;
  iconKey: keyof typeof ICONS;
  permission?: string;
};

export type NavGroup = {
  label: string;
  iconKey: keyof typeof ICONS;
  permission?: string;
  children: NavLeaf[];
};

export type NavItem = NavLeaf | NavGroup;

export function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', iconKey: 'dashboard' },
  {
    label: 'Group Control',
    iconKey: 'lock',
    permission: 'group-control.view',
    children: [
      {
        href: '/group-control',
        label: 'Overview',
        iconKey: 'dashboard',
        permission: 'group-control.view',
      },
      {
        href: '/group-control/bank-accounts',
        label: 'Bank Accounts',
        iconKey: 'bank',
        permission: 'bank-accounts.read',
      },
      {
        href: '/group-control/loans-debts',
        label: 'Loans & Debts',
        iconKey: 'creditCard',
        permission: 'loans.read',
      },
      {
        href: '/group-control/contracts',
        label: 'Contracts',
        iconKey: 'fileText',
        permission: 'contracts.read',
      },
      {
        href: '/group-control/fixed-assets',
        label: 'Fixed Assets',
        iconKey: 'box',
        permission: 'fixed-assets.read',
      },
      {
        href: '/group-control/documents',
        label: 'Documents',
        iconKey: 'document',
        permission: 'documents.read',
      },
      {
        href: '/audit-logs',
        label: 'Audit Trail',
        iconKey: 'clipboardList',
        permission: 'audit-logs.read',
      },
    ],
  },
  {
    label: 'Registry',
    iconKey: 'building',
    children: [
      { href: '/companies', label: 'Companies', iconKey: 'building', permission: 'companies.read' },
      { href: '/users', label: 'Users', iconKey: 'users', permission: 'users.read' },
      { href: '/roles', label: 'Roles', iconKey: 'shield', permission: 'roles.read' },
    ],
  },
  {
    label: 'Operations',
    iconKey: 'settings',
    permission: 'operations.dashboard.view',
    children: [
      {
        href: '/operations',
        label: 'Dashboard',
        iconKey: 'barChart',
        permission: 'operations.dashboard.view',
      },
      {
        href: '/operations/customers',
        label: 'Customers',
        iconKey: 'users',
        permission: 'customers.view',
      },
      {
        href: '/operations/suppliers',
        label: 'Suppliers',
        iconKey: 'building',
        permission: 'suppliers.view',
      },
      {
        href: '/operations/products',
        label: 'Products',
        iconKey: 'fileText',
        permission: 'products.view',
      },
      {
        href: '/operations/product-categories',
        label: 'Product Categories',
        iconKey: 'clipboardList',
        permission: 'product_categories.view',
      },
      {
        href: '/operations/units',
        label: 'Units of Measure',
        iconKey: 'scale',
        permission: 'units.view',
      },
      {
        href: '/operations/inventory-balances',
        label: 'Inventory Balances',
        iconKey: 'barChart',
        permission: 'inventory.view',
      },
      {
        href: '/operations/inventory-movements',
        label: 'Inventory Movements',
        iconKey: 'fileText',
        permission: 'inventory.movements.view',
      },
      {
        href: '/operations/stock-adjustments',
        label: 'Stock Adjustments',
        iconKey: 'clipboardList',
        permission: 'inventory.adjustments.create',
      },
      {
        href: '/operations/sales-orders',
        label: 'Sales Orders',
        iconKey: 'creditCard',
        permission: 'sales.view',
      },
      {
        href: '/operations/mobile-pos',
        label: 'Mobile POS',
        iconKey: 'creditCard',
        permission: 'sales.create',
      },
      {
        href: '/operations/purchase-orders',
        label: 'Purchase Orders',
        iconKey: 'creditCard',
        permission: 'purchases.view',
      },
      {
        href: '/operations/reports',
        label: 'Reports',
        iconKey: 'barChart',
        permission: 'operations.reports.view',
      },
    ],
  },
  {
    label: 'Finance',
    iconKey: 'creditCard',
    permission: 'finance.view',
    children: [
      { href: '/finance', label: 'Dashboard', iconKey: 'barChart', permission: 'finance.view' },
      {
        href: '/finance/chart-of-accounts',
        label: 'Chart of Accounts',
        iconKey: 'fileText',
        permission: 'chart_of_accounts.view',
      },
      {
        href: '/finance/fiscal-years',
        label: 'Fiscal Years',
        iconKey: 'clipboardList',
        permission: 'fiscal_years.view',
      },
      {
        href: '/finance/accounting-periods',
        label: 'Accounting Periods',
        iconKey: 'clipboardList',
        permission: 'accounting_periods.view',
      },
      {
        href: '/finance/journal-entries',
        label: 'Journal Entries',
        iconKey: 'fileText',
        permission: 'journal_entries.view',
      },
      {
        href: '/finance/cash-accounts',
        label: 'Cash Accounts',
        iconKey: 'creditCard',
        permission: 'cash_accounts.view',
      },
      {
        href: '/finance/expenses',
        label: 'Expenses',
        iconKey: 'creditCard',
        permission: 'expenses.view',
      },
      {
        href: '/finance/receivables',
        label: 'Receivables',
        iconKey: 'scale',
        permission: 'receivables.view',
      },
      {
        href: '/finance/payables',
        label: 'Payables',
        iconKey: 'scale',
        permission: 'payables.view',
      },
      {
        href: '/finance/intercompany',
        label: 'Inter-Company',
        iconKey: 'building',
        permission: 'intercompany.view',
      },
      {
        href: '/finance/reports',
        label: 'Reports',
        iconKey: 'barChart',
        permission: 'finance.reports.view',
      },
    ],
  },
  {
    label: 'Westsides',
    iconKey: 'box',
    permission: 'westsides.dashboard.view',
    children: [
      {
        href: '/westsides',
        label: 'Dashboard',
        iconKey: 'barChart',
        permission: 'westsides.dashboard.view',
      },
      {
        href: '/westsides/quick-sale',
        label: 'Quick Sale',
        iconKey: 'creditCard',
        permission: 'sales.create',
      },
      {
        href: '/westsides/customers',
        label: 'Customers',
        iconKey: 'users',
        permission: 'customers.view',
      },
      {
        href: '/westsides/inventory/live',
        label: 'Live Inventory',
        iconKey: 'box',
        permission: 'inventory.view',
      },
      {
        href: '/westsides/daily-close',
        label: 'Daily Close',
        iconKey: 'fileText',
        permission: 'westsides.reports.view',
      },
      {
        href: '/westsides/price-lists',
        label: 'Price Lists',
        iconKey: 'clipboardList',
        permission: 'price_lists.view',
      },
      {
        href: '/westsides/customer-price-agreements',
        label: 'Price Agreements',
        iconKey: 'scale',
        permission: 'customer_price_agreements.view',
      },
      {
        href: '/westsides/product-batches',
        label: 'Product Batches',
        iconKey: 'box',
        permission: 'product_batches.view',
      },
      {
        href: '/westsides/stock-damage',
        label: 'Stock Damage',
        iconKey: 'clipboardList',
        permission: 'stock_damage.view',
      },
      {
        href: '/westsides/returnable-packages',
        label: 'Ret. Packages',
        iconKey: 'box',
        permission: 'returnable_packages.view',
      },
      {
        href: '/westsides/package-movements',
        label: 'Pkg Movements',
        iconKey: 'box',
        permission: 'package_movements.view',
      },
      {
        href: '/westsides/quotations',
        label: 'Quotations',
        iconKey: 'clipboardList',
        permission: 'quotations.view',
      },
      {
        href: '/westsides/proforma-invoices',
        label: 'Proformas',
        iconKey: 'clipboardList',
        permission: 'proformas.view',
      },
      {
        href: '/westsides/delivery-notes',
        label: 'Delivery Notes',
        iconKey: 'clipboardList',
        permission: 'delivery_notes.view',
      },
      {
        href: '/westsides/reports',
        label: 'Reports',
        iconKey: 'barChart',
        permission: 'westsides.reports.view',
      },
    ],
  },
  {
    label: 'HR & Payroll',
    iconKey: 'users',
    permission: 'hr.dashboard.view',
    children: [
      { href: '/hr', label: 'Dashboard', iconKey: 'barChart', permission: 'hr.dashboard.view' },
      {
        href: '/hr/departments',
        label: 'Departments',
        iconKey: 'building',
        permission: 'hr.departments.view',
      },
      {
        href: '/hr/positions',
        label: 'Positions',
        iconKey: 'clipboardList',
        permission: 'hr.positions.view',
      },
      {
        href: '/hr/employees',
        label: 'Employees',
        iconKey: 'users',
        permission: 'hr.employees.view',
      },
      {
        href: '/hr/employee-assignments',
        label: 'Assignments',
        iconKey: 'clipboardList',
        permission: 'hr.assignments.view',
      },
      {
        href: '/hr/employment-contracts',
        label: 'Contracts',
        iconKey: 'fileText',
        permission: 'hr.contracts.view',
      },
      {
        href: '/hr/work-shifts',
        label: 'Work Shifts',
        iconKey: 'settings',
        permission: 'hr.shifts.view',
      },
      {
        href: '/hr/shift-schedules',
        label: 'Shift Schedules',
        iconKey: 'clipboardList',
        permission: 'hr.schedules.view',
      },
      {
        href: '/hr/attendance',
        label: 'Attendance',
        iconKey: 'clipboardList',
        permission: 'hr.attendance.view',
      },
      {
        href: '/hr/leave-types',
        label: 'Leave Types',
        iconKey: 'fileText',
        permission: 'hr.leave_types.view',
      },
      {
        href: '/hr/leave-requests',
        label: 'Leave Requests',
        iconKey: 'clipboardList',
        permission: 'hr.leave.view',
      },
      {
        href: '/hr/allowance-types',
        label: 'Allowance Types',
        iconKey: 'scale',
        permission: 'hr.allowances.view',
      },
      {
        href: '/hr/deduction-types',
        label: 'Deduction Types',
        iconKey: 'scale',
        permission: 'hr.deductions.view',
      },
      {
        href: '/hr/employee-allowances',
        label: 'Emp. Allowances',
        iconKey: 'creditCard',
        permission: 'hr.emp_allowances.view',
      },
      {
        href: '/hr/employee-deductions',
        label: 'Emp. Deductions',
        iconKey: 'creditCard',
        permission: 'hr.emp_deductions.view',
      },
      {
        href: '/hr/payroll-periods',
        label: 'Payroll Periods',
        iconKey: 'clipboardList',
        permission: 'hr.payroll.view',
      },
      {
        href: '/hr/payroll-runs',
        label: 'Payroll Runs',
        iconKey: 'barChart',
        permission: 'hr.payroll.view',
      },
      {
        href: '/hr/payroll-entries',
        label: 'Payroll Entries',
        iconKey: 'fileText',
        permission: 'hr.payroll.view',
      },
      {
        href: '/hr/salary-payments',
        label: 'Salary Payments',
        iconKey: 'creditCard',
        permission: 'hr.payments.view',
      },
      {
        href: '/hr/salary-advances',
        label: 'Salary Advances',
        iconKey: 'creditCard',
        permission: 'hr.advances.view',
      },
      {
        href: '/hr/performance',
        label: 'Performance',
        iconKey: 'barChart',
        permission: 'hr.performance.view',
      },
      {
        href: '/hr/hr-documents',
        label: 'HR Documents',
        iconKey: 'document',
        permission: 'hr.documents.view',
      },
      { href: '/hr/reports', label: 'Reports', iconKey: 'barChart', permission: 'hr.reports.view' },
    ],
  },
  {
    label: 'Compliance & Tax',
    iconKey: 'shield',
    permission: 'compliance.dashboard.view',
    children: [
      {
        href: '/compliance',
        label: 'Dashboard',
        iconKey: 'barChart',
        permission: 'compliance.dashboard.view',
      },
      {
        href: '/compliance/tax-authorities',
        label: 'Tax Authorities',
        iconKey: 'building',
        permission: 'tax_authorities.view',
      },
      {
        href: '/compliance/tax-registrations',
        label: 'Tax Registrations',
        iconKey: 'document',
        permission: 'tax_registrations.view',
      },
      {
        href: '/compliance/tax-types',
        label: 'Tax Types',
        iconKey: 'fileText',
        permission: 'tax_types.view',
      },
      {
        href: '/compliance/tax-rates',
        label: 'Tax Rates',
        iconKey: 'creditCard',
        permission: 'tax_rates.view',
      },
      {
        href: '/compliance/tax-codes',
        label: 'Tax Codes',
        iconKey: 'clipboardList',
        permission: 'tax_codes.view',
      },
      {
        href: '/compliance/tax-transactions',
        label: 'Tax Transactions',
        iconKey: 'scale',
        permission: 'tax_transactions.view',
      },
      {
        href: '/compliance/tax-filing-periods',
        label: 'Filing Periods',
        iconKey: 'clipboardList',
        permission: 'tax_filing_periods.view',
      },
      {
        href: '/compliance/tax-returns',
        label: 'Tax Returns',
        iconKey: 'fileText',
        permission: 'tax_returns.view',
      },
      {
        href: '/compliance/obligations',
        label: 'Obligations',
        iconKey: 'clipboardList',
        permission: 'compliance_obligations.view',
      },
      {
        href: '/compliance/calendar',
        label: 'Compliance Calendar',
        iconKey: 'clipboardList',
        permission: 'compliance_calendar.view',
      },
      {
        href: '/compliance/statutory-rules',
        label: 'Statutory Rules',
        iconKey: 'scale',
        permission: 'statutory_rules.view',
      },
      {
        href: '/compliance/document-requirements',
        label: 'Doc Requirements',
        iconKey: 'document',
        permission: 'compliance_document_requirements.view',
      },
      {
        href: '/compliance/document-status',
        label: 'Document Status',
        iconKey: 'fileText',
        permission: 'compliance_document_status.view',
      },
      {
        href: '/compliance/events',
        label: 'Compliance Events',
        iconKey: 'barChart',
        permission: 'compliance_events.view',
      },
      {
        href: '/compliance/evidence-packs',
        label: 'Evidence Packs',
        iconKey: 'box',
        permission: 'audit_evidence_packs.view',
      },
      {
        href: '/compliance/exports',
        label: 'Data Exports',
        iconKey: 'settings',
        permission: 'data_exports.view',
      },
      {
        href: '/compliance/reports',
        label: 'Reports',
        iconKey: 'barChart',
        permission: 'compliance.reports.view',
      },
    ],
  },
  { href: '/reports', label: 'Reports', iconKey: 'barChart', permission: undefined },
  { href: '/settings', label: 'Settings', iconKey: 'settings', permission: undefined },
  // === Approvals & Controls (M11) ===
  {
    label: 'Approvals',
    iconKey: 'checkCircle',
    permission: 'approvals.dashboard.view',
    children: [
      {
        href: '/approvals',
        label: 'Dashboard',
        iconKey: 'barChart',
        permission: 'approvals.dashboard.view',
      },
      {
        href: '/approvals/workflows',
        label: 'Workflows',
        iconKey: 'fileText',
        permission: 'approval_workflows.view',
      },
      {
        href: '/approvals/requests',
        label: 'Requests',
        iconKey: 'clipboardList',
        permission: 'approval_requests.view',
      },
      {
        href: '/approvals/pending',
        label: 'Pending Approvals',
        iconKey: 'checkCircle',
        permission: 'approval_requests.approve',
      },
      {
        href: '/approvals/delegations',
        label: 'Delegations',
        iconKey: 'users',
        permission: 'approval_delegations.view',
      },
    ],
  },
  {
    href: '/notifications',
    label: 'Notifications',
    iconKey: 'bell',
    permission: 'notifications.view',
  },
  {
    label: 'Alerts',
    iconKey: 'exclamationTriangle',
    permission: 'alert_events.view',
    children: [
      {
        href: '/alerts',
        label: 'Alert Events',
        iconKey: 'exclamationTriangle',
        permission: 'alert_events.view',
      },
      {
        href: '/alerts/rules',
        label: 'Alert Rules',
        iconKey: 'settings',
        permission: 'alert_rules.view',
      },
    ],
  },
  { href: '/tasks', label: 'Tasks', iconKey: 'clipboardList', permission: 'tasks.view' },
  {
    href: '/internal-controls',
    label: 'Internal Controls',
    iconKey: 'shieldCheck',
    permission: 'internal_controls.view',
  },
  // === Integrations & API (M13) ===
  {
    label: 'Integrations & API',
    iconKey: 'integration',
    permission: 'integrations.dashboard.view',
    children: [
      {
        href: '/integrations',
        label: 'Dashboard',
        iconKey: 'barChart',
        permission: 'integrations.dashboard.view',
      },
      {
        href: '/integrations/providers',
        label: 'Providers',
        iconKey: 'integration',
        permission: 'integration_providers.view',
      },
      {
        href: '/integrations/connections',
        label: 'Connections',
        iconKey: 'server',
        permission: 'integration_connections.view',
      },
      {
        href: '/integrations/events',
        label: 'Events Log',
        iconKey: 'clipboardList',
        permission: 'integration_events.view',
      },
      {
        href: '/integrations/webhooks',
        label: 'Webhook Endpoints',
        iconKey: 'webhook',
        permission: 'webhook_endpoints.view',
      },
      {
        href: '/integrations/webhook-events',
        label: 'Webhook Events',
        iconKey: 'clipboardList',
        permission: 'webhook_events.view',
      },
      {
        href: '/integrations/payments',
        label: 'External Payments',
        iconKey: 'creditCard',
        permission: 'external_payments.view',
      },
      {
        href: '/integrations/messages',
        label: 'Messages',
        iconKey: 'bell',
        permission: 'external_messages.view',
      },
      {
        href: '/integrations/templates',
        label: 'Templates',
        iconKey: 'fileText',
        permission: 'message_templates.view',
      },
      {
        href: '/integrations/mappings',
        label: 'Mappings',
        iconKey: 'clipboardList',
        permission: 'integration_mappings.view',
      },
    ],
  },
  // === BI & Executive Intelligence (M12) ===
  // === Security & Audit (M14) ===
  {
    label: 'Security & Audit',
    iconKey: 'ShieldCheck',
    permission: 'security.dashboard.view',
    children: [
      {
        href: '/security',
        label: 'Security Dashboard',
        iconKey: 'ShieldCheck',
        permission: 'security.dashboard.view',
      },
      {
        href: '/security/policies',
        label: 'Security Policies',
        iconKey: 'ShieldCheck',
        permission: 'security_policies.view',
      },
      {
        href: '/security/user-profiles',
        label: 'User Security Profiles',
        iconKey: 'ShieldCheck',
        permission: 'user_security_profiles.view',
      },
      {
        href: '/security/events',
        label: 'Security Events',
        iconKey: 'ShieldCheck',
        permission: 'security_events.view',
      },
      {
        href: '/security/sessions',
        label: 'Active Sessions',
        iconKey: 'ShieldCheck',
        permission: 'active_sessions.view',
      },
      {
        href: '/security/two-factor',
        label: 'Two-Factor Auth',
        iconKey: 'ShieldCheck',
        permission: 'two_factor.manage',
      },
    ],
  },
  {
    label: 'Backup & Recovery',
    iconKey: 'Database',
    permission: 'backups.dashboard.view',
    children: [
      {
        href: '/backups',
        label: 'Backup Dashboard',
        iconKey: 'Database',
        permission: 'backups.dashboard.view',
      },
      {
        href: '/backups/jobs',
        label: 'Backup Jobs',
        iconKey: 'Database',
        permission: 'backup_jobs.view',
      },
      {
        href: '/backups/runs',
        label: 'Backup Runs',
        iconKey: 'Database',
        permission: 'backup_runs.view',
      },
      {
        href: '/backups/restore-tests',
        label: 'Restore Tests',
        iconKey: 'Database',
        permission: 'restore_tests.view',
      },
      {
        href: '/backups/disaster-recovery',
        label: 'Disaster Recovery',
        iconKey: 'Database',
        permission: 'disaster_recovery.view',
      },
    ],
  },
  // === Accounting Engine (M14.5) ===
  {
    label: 'Accounting Engine',
    iconKey: 'accountingEngine',
    permission: 'accounting_engine.dashboard',
    children: [
      { href: '/accounting-engine', label: 'Dashboard', iconKey: 'accountingEngine' },
      { href: '/accounting-engine/posting-rules', label: 'Posting Rules', iconKey: 'document' },
      { href: '/accounting-engine/posting-runs', label: 'Posting Runs', iconKey: 'document' },
      { href: '/accounting-engine/period-close', label: 'Period Close', iconKey: 'document' },
      {
        href: '/accounting-engine/accounting-locks',
        label: 'Accounting Locks',
        iconKey: 'document',
      },
      {
        href: '/accounting-engine/bank-reconciliations',
        label: 'Bank Reconciliations',
        iconKey: 'document',
      },
      { href: '/accounting-engine/depreciation', label: 'Depreciation', iconKey: 'document' },
      { href: '/accounting-engine/loan-repayments', label: 'Loan Repayments', iconKey: 'document' },
      {
        href: '/accounting-engine/financial-statements',
        label: 'Financial Statements',
        iconKey: 'document',
      },
      {
        href: '/accounting-engine/audit-adjustments',
        label: 'Audit Adjustments',
        iconKey: 'document',
      },
    ],
  },
  // === Procurement (M14.5) ===
  {
    label: 'Procurement',
    iconKey: 'procurement',
    permission: 'procurement.dashboard',
    children: [
      { href: '/procurement', label: 'Dashboard', iconKey: 'procurement' },
      { href: '/procurement/requisitions', label: 'Requisitions', iconKey: 'document' },
      { href: '/procurement/rfqs', label: 'RFQs', iconKey: 'document' },
      {
        href: '/procurement/supplier-quotations',
        label: 'Supplier Quotations',
        iconKey: 'document',
      },
      { href: '/procurement/bid-comparisons', label: 'Bid Comparisons', iconKey: 'document' },
      { href: '/procurement/grns', label: 'Goods Received', iconKey: 'document' },
      { href: '/procurement/supplier-invoices', label: 'Supplier Invoices', iconKey: 'document' },
      { href: '/procurement/three-way-matching', label: 'Three-Way Match', iconKey: 'document' },
      { href: '/procurement/plans', label: 'Procurement Plans', iconKey: 'document' },
    ],
  },
  // === CRM / SRM (M14.5) ===
  {
    label: 'CRM / SRM',
    iconKey: 'crm',
    permission: 'crm.dashboard',
    children: [
      { href: '/crm', label: 'Dashboard', iconKey: 'crm' },
      { href: '/crm/contact-persons', label: 'Contact Persons', iconKey: 'users' },
      { href: '/crm/communication-logs', label: 'Communications', iconKey: 'document' },
      { href: '/crm/credit-profiles', label: 'Credit Profiles', iconKey: 'document' },
      { href: '/crm/supplier-performance', label: 'Supplier Performance', iconKey: 'document' },
      { href: '/crm/customer-segments', label: 'Customer Segments', iconKey: 'document' },
      { href: '/crm/customer-statements', label: 'Customer Statements', iconKey: 'document' },
      { href: '/crm/supplier-statements', label: 'Supplier Statements', iconKey: 'document' },
    ],
  },
  // === Document Templates (M14.5) ===
  {
    label: 'Document Templates',
    iconKey: 'docTemplate',
    permission: 'document_templates.list',
    children: [
      { href: '/document-templates', label: 'Templates', iconKey: 'docTemplate' },
      { href: '/document-templates/generated', label: 'Generated Docs', iconKey: 'document' },
      { href: '/document-templates/sequences', label: 'Number Sequences', iconKey: 'document' },
      { href: '/document-templates/print-engine', label: 'Print Engine', iconKey: 'document' },
    ],
  },
  // === Business Automation (M14.5) ===
  // === QA & Launch (M16) ===
  // === Performance & Ops (M15) ===
];

// ─── Helper: is path active ───────────────────────────────────────────────────
function isActive(href: string, pathname: string) {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(href + '/');
}

// ─── Sidebar Component ────────────────────────────────────────────────────────
interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { hasPermission, loading } = useAuth();

  // Auto-expand group if a child is active
  function groupHasActive(group: NavGroup) {
    return group.children.some((c) => isActive(c.href, pathname));
  }

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    NAV.forEach((item) => {
      if (isGroup(item) && groupHasActive(item)) {
        init[item.label] = true;
      }
    });
    return init;
  });

  function toggle(label: string) {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function canSee(permission?: string) {
    if (!permission) return true;
    return hasPermission(permission);
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={onClose} aria-hidden />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-30 h-full w-60 flex flex-col
          bg-sidebar-bg border-r border-sidebar-border
          transform transition-transform duration-200
          lg:static lg:translate-x-0 lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-brand-600 text-white font-bold text-sm flex items-center justify-center flex-shrink-0">
            IR
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-white text-sm leading-none">ITEMBA-R</div>
            <div className="text-[10px] text-sidebar-text mt-0.5 truncate">Group Governance</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {loading ? (
            <div className="px-3 py-2 text-xs text-sidebar-text animate-pulse">Loading…</div>
          ) : (
            NAV.map((item) => {
              if (!isGroup(item)) {
                if (!canSee(item.permission)) return null;
                const active = isActive(item.href, pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors
                      ${
                        active
                          ? 'bg-sidebar-active text-white border-l-2 border-brand-500 pl-[10px]'
                          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-textHigh'
                      }
                    `}
                  >
                    <Icon d={ICONS[item.iconKey]} />
                    {item.label}
                  </Link>
                );
              }

              // Group
              const visibleChildren = item.children.filter((c) => canSee(c.permission));
              if (!canSee(item.permission) && visibleChildren.length === 0) return null;
              const isOpen = expanded[item.label] ?? false;
              const anyChildActive = groupHasActive(item);

              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggle(item.label)}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors
                      ${
                        anyChildActive
                          ? 'text-sidebar-textHigh'
                          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-textHigh'
                      }
                    `}
                  >
                    <Icon d={ICONS[item.iconKey]} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <Icon
                      d={isOpen ? ICONS.chevronDown : ICONS.chevronRight}
                      className="w-3 h-3 opacity-60"
                    />
                  </button>

                  {isOpen && visibleChildren.length > 0 && (
                    <div className="ml-4 mt-0.5 pl-3 border-l border-sidebar-border space-y-0.5">
                      {visibleChildren.map((child) => {
                        const active = isActive(child.href, pathname);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={onClose}
                            className={`
                              flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors
                              ${
                                active
                                  ? 'bg-sidebar-active text-white'
                                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-textHigh'
                              }
                            `}
                          >
                            <Icon d={ICONS[child.iconKey]} className="w-3 h-3" />
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </nav>

      </aside>
    </>
  );
}
