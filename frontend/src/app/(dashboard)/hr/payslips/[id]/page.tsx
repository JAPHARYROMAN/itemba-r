'use client';
import { useParams } from 'next/navigation';
import { PayslipDetail } from '@/features/payroll/payslip-detail';

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  return <PayslipDetail key={id} payslipId={id} />;
}
