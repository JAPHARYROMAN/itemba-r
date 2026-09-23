import { PayrollPeopleTools } from '@/features/payroll/payroll-people-tools';
export const metadata = { title: 'Organisation · Payroll · ITEMBA OS' };
export default function Page() {
  return <PayrollPeopleTools kind="organisation" />;
}
