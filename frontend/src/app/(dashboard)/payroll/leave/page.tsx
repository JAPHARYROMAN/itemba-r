import { PayrollPeopleTools } from '@/features/payroll/payroll-people-tools';
export const metadata = { title: 'Leave · Payroll · ITEMBA OS' };
export default function Page() {
  return <PayrollPeopleTools kind="leave" />;
}
