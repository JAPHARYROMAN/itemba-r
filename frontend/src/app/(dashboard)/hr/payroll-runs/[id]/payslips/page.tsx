'use client';
import { useParams } from 'next/navigation';
import { RunPayslips } from '@/features/payroll/run-payslips';

export default function RunPayslipsPage() {
  const { id } = useParams<{ id: string }>();
  return <RunPayslips key={id} runId={id} />;
}
