/**
 * Small labels used by the company profile's screen view (the print
 * documents' labels live in ./print).
 */
import 'server-only';

export const profileScreenCopy = {
  /** "Division 1", "Division 2", … */
  divisionLabel: 'Division',
  contact: {
    heading: 'Group Contact',
    headOffice: 'Head Office',
    postal: 'Postal',
    phone: 'Phone',
    email: 'Email',
  },
} as const;
