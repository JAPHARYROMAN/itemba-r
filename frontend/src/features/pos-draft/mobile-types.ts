import type { PosRole } from './types';
export type MobileProfile = {
  user: { id: string; fullName?: string; mobilePosCredentialVersion?: number };
  operator: { id: string; name: string; role: PosRole; credentialVersion: number };
  enrollmentId: string;
  terminalCode: string;
  role: PosRole;
  company: { id: string; name: string };
  division: { id: string; name: string };
  branch: { id: string; name: string };
  capabilities: {
    captureSales: boolean;
    captureStock: boolean;
    dispatchStock: boolean;
    approve: boolean;
  };
};
export type EnrollmentProfile = {
  enrollmentId: string;
  status: string;
  role: PosRole;
  name: string;
  company: { id: string; name: string };
  division: { id: string; name: string };
  branch: { id: string; name: string };
  pinReady: boolean;
  resetRequired?: boolean;
};
export type InviteProfile = {
  company: { id: string; name: string };
  division: { id: string; name: string };
  branch: { id: string; name: string };
};
