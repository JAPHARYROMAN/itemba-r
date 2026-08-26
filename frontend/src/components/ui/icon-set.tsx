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
  ChevronDown,
  CircleAlert,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Fuel,
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
  Sparkles,
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
  ExternalLink,
  X,
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
  fuel: Fuel,
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
  close: X,
  chevronDown: ChevronDown,
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
  external: ExternalLink,
  // The assistant. Sparkles rather than a robot face: Msaidizi acts as the
  // person using it, under their own badge, and a robot icon says the opposite.
  assistant: Sparkles,
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
