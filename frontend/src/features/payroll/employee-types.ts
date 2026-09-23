export interface Employee {
  id: string;
  updatedAt?: string;
  employeeCode: string;
  userId?: string | null;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName?: string;
  gender?: string;
  dateOfBirth?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;

  // Identity
  identificationType?: string;
  identificationNumber?: string;
  nidaNumber?: string;
  passportNumber?: string;
  passportCountry?: string;
  votersIdNumber?: string;

  // Tax & statutory
  tin?: string;
  nssfNumber?: string;
  nhifNumber?: string;
  pssfNumber?: string;
  wcfRegistrationNumber?: string;
  heslbNumber?: string;
  heslbBorrower?: boolean;
  taxResidencyStatus?: string;
  disabilityStatus?: string;
  disabilityCertificateNo?: string;
  dependents?: number;
  payrollRegion?: string;

  // Payment
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  mobileMoneyNumber?: string;

  // Org
  company?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
  position?: { id: string; title: string } | null;

  // Employment
  employmentType?: string;
  employmentStatus?: string;
  pendingTerminationDate?: string | null;
  terminationRequestedAt?: string | null;
  terminationRequestedById?: string | null;
  terminationReason?: string | null;
  hireDate?: string;
  terminationDate?: string;
  baseSalary?: number | string;
  salaryCurrency?: string;
  paymentFrequency?: string;

  // Audit
  notes?: string;
}
