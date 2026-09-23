import type { Employee } from './employee-types';

export const employeeSectionFields = {
  profile: [
    'firstName',
    'middleName',
    'lastName',
    'gender',
    'dateOfBirth',
    'nationality',
    'email',
    'phone',
    'address',
    'emergencyContactName',
    'emergencyContactPhone',
    'userId',
    'employmentStatus',
    'terminationDate',
    'baseSalary',
    'paymentFrequency',
  ],
  statutory: [
    'nidaNumber',
    'votersIdNumber',
    'passportNumber',
    'passportCountry',
    'tin',
    'taxResidencyStatus',
    'payrollRegion',
    'dependents',
    'disabilityStatus',
    'disabilityCertificateNo',
    'nssfNumber',
    'pssfNumber',
    'nhifNumber',
    'wcfRegistrationNumber',
    'heslbNumber',
    'heslbBorrower',
  ],
  banking: ['bankName', 'bankAccountName', 'bankAccountNumber', 'mobileMoneyNumber'],
} as const;
export type EmployeeSection = keyof typeof employeeSectionFields;
export type EmployeeField = (typeof employeeSectionFields)[EmployeeSection][number];
export type EmployeeEditValues = Partial<
  Record<Exclude<EmployeeField, 'heslbBorrower'>, string>
> & {
  heslbBorrower?: boolean;
};
export const employeeSensitiveFields: readonly EmployeeField[] = [
  'baseSalary',
  'bankName',
  'bankAccountNumber',
  'tin',
  'nssfNumber',
  'nhifNumber',
];
export const employeeFieldLabels: Record<EmployeeField, string> = {
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  nationality: 'Nationality',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  emergencyContactName: 'Emergency contact name',
  emergencyContactPhone: 'Emergency contact phone',
  userId: 'User account',
  employmentStatus: 'Status',
  terminationDate: 'Termination date',
  baseSalary: 'Base salary',
  paymentFrequency: 'Payment frequency',
  nidaNumber: 'NIDA number',
  votersIdNumber: 'Voter ID',
  passportNumber: 'Passport',
  passportCountry: 'Passport country',
  tin: 'TIN',
  taxResidencyStatus: 'Tax residency',
  payrollRegion: 'Payroll region',
  dependents: 'Dependents',
  disabilityStatus: 'Disability status',
  disabilityCertificateNo: 'PWD certificate',
  nssfNumber: 'NSSF number',
  pssfNumber: 'PSSSF number',
  nhifNumber: 'NHIF number',
  wcfRegistrationNumber: 'WCF number',
  heslbNumber: 'HESLB number',
  heslbBorrower: 'Active HESLB borrower',
  bankName: 'Bank name',
  bankAccountName: 'Account name',
  bankAccountNumber: 'Account number',
  mobileMoneyNumber: 'Mobile money number',
};
const defaults: EmployeeEditValues = {
  gender: 'NOT_SPECIFIED',
  employmentStatus: 'ACTIVE',
  paymentFrequency: 'MONTHLY',
  taxResidencyStatus: 'RESIDENT',
  payrollRegion: 'MAINLAND',
  dependents: '0',
  disabilityStatus: 'NONE',
};

export function employeeEditableFields(section: EmployeeSection, canSensitive: boolean) {
  return employeeSectionFields[section].filter(
    (field) => canSensitive || !employeeSensitiveFields.includes(field),
  );
}

/** Normalise fresh data for controls. Drafts contain only explicitly edited fields. */
export function employeeEditBaseline(
  record: Employee,
  section: EmployeeSection,
  canSensitive: boolean,
): EmployeeEditValues {
  return Object.fromEntries(
    employeeEditableFields(section, canSensitive).map((field) => {
      const value = record[field];
      return [
        field,
        field === 'heslbBorrower'
          ? !!value
          : field === 'dateOfBirth' || field === 'terminationDate'
            ? String(value ?? '').slice(0, 10)
            : String(value ?? defaults[field] ?? ''),
      ];
    }),
  );
}

export function employeeEditPayload(
  record: Employee,
  section: EmployeeSection,
  edits: EmployeeEditValues,
  canSensitive: boolean,
) {
  const baseline = employeeEditBaseline(record, section, canSensitive);
  const payload: Record<string, string | number | boolean | null> = {};
  for (const field of employeeEditableFields(section, canSensitive)) {
    const value = edits[field];
    if (value === undefined || value === baseline[field]) continue;
    if (field === 'heslbBorrower') {
      if (typeof value !== 'boolean')
        throw new Error('Choose whether this employee is an HESLB borrower.');
      payload[field] = value;
    } else {
      if (typeof value !== 'string')
        throw new Error(`Check ${employeeFieldLabels[field].toLowerCase()}.`);
      if (field === 'baseSalary' || field === 'dependents') {
        const amount = Number(value);
        if (
          !value.trim() ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          (field === 'dependents' && !Number.isInteger(amount))
        )
          throw new Error(`Enter a valid ${employeeFieldLabels[field].toLowerCase()}.`);
        payload[field] = amount;
      } else {
        const text = value.trim();
        if ((field === 'firstName' || field === 'lastName') && !text)
          throw new Error('First and last names are required.');
        if (field === 'employmentStatus' && text === 'TERMINATED')
          throw new Error('Use Request Termination from the employee profile.');
        payload[field] = text || null;
      }
    }
  }
  if (['firstName', 'middleName', 'lastName'].some((field) => Object.hasOwn(payload, field))) {
    payload.fullName = (['firstName', 'middleName', 'lastName'] as const)
      .map((field) => (Object.hasOwn(payload, field) ? payload[field] : record[field]))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return payload;
}
