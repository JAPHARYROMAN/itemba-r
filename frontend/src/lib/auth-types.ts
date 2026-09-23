/** Shared auth types used across the frontend. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  companyId: string | null;
  companyAccess?: Array<{ companyId: string; accessLevel: string }>;
  divisionAccess?: Array<{ divisionId: string; accessLevel: string }>;
  branchAccess?: Array<{ branchId: string; accessLevel: string }>;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}
