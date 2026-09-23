'use client';
import { useParams } from 'next/navigation';
import { EmployeeDetail } from '@/features/payroll/employee-detail';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <EmployeeDetail key={id} employeeId={id} />;
}
