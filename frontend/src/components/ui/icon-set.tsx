'use client';
import React from 'react';
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Hash,
  Home,
  Landmark,
  LayoutDashboard,
  Lock,
  LogIn,
  Minus,
  Package,
  PackageOpen,
  Percent,
  PiggyBank,
  Play,
  Receipt,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Truck,
  User,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  Zap,
} from 'lucide-react';

/**
 * Central domain-icon registry. One stroke icon language across the app —
 * replaces the per-OS emoji previously used in the command palette and cards.
 * Add new names here rather than importing lucide-react directly in pages, so
 * sizing and stroke stay consistent everywhere.
 */
const ICONS = {
  // Navigation / structure
  dashboard: LayoutDashboard,
  company: Building2,
  branch: Warehouse,
  settings: Settings,
  security: ShieldCheck,
  lock: Lock,
  // Commerce
  product: Package,
  inventory: Boxes,
  order: Receipt,
  purchase: PackageOpen,
  quotation: ClipboardList,
  document: FileText,
  delivery: Truck,
  pos: CreditCard,
  sale: ShoppingCart,
  // Finance
  finance: Wallet,
  bank: Landmark,
  cash: Banknote,
  ledger: ScrollText,
  report: BarChart3,
  statement: FileSpreadsheet,
  tax: Scale,
  loan: PiggyBank,
  payment: HandCoins,
  calculator: Calculator,
  // People
  customer: User,
  customers: Users,
  employee: UserCog,
  hr: Briefcase,
  // Status / feedback
  approved: BadgeCheck,
  done: CheckCircle2,
  alert: TriangleAlert,
  error: CircleAlert,
  bell: Bell,
  search: Search,
  transfer: ArrowLeftRight,
  calendar: CalendarDays,
  trendUp: TrendingUp,
  trendDown: TrendingDown,
  trendFlat: Minus,
  // Misc routes
  home: Home,
  login: LogIn,
  signup: UserPlus,
  automation: Zap,
  run: Play,
  sequence: Hash,
  commission: Percent,
  medical: Stethoscope,
} as const;

export type AppIconName = keyof typeof ICONS;

interface AppIconProps {
  name: AppIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function AppIcon({ name, size = 16, className, strokeWidth = 2 }: AppIconProps) {
  const Icon = ICONS[name];
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
