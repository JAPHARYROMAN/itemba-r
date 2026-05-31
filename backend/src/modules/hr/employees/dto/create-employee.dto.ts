import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DisabilityStatus,
  EmployeeTaxResidency,
  EmploymentStatus,
  EmploymentType,
  Gender,
  HolidayRegion,
  HRPaymentFrequency,
} from '@prisma/client';

/**
 * Tanzania NIDA numbers are 20 digits in the canonical "x-xxxxx-xxxxx-xxxxx-xx" or
 * pure-numeric form. Accept either by stripping non-digits at the service layer;
 * here we just enforce the 20-digit signature once stripped.
 */
const NIDA_REGEX = /^\d{20}$|^\d{8}-\d{5}-\d{5}-\d{2}$/;

export class CreateEmployeeDto {
  // ── Org placement ──────────────────────────────────────────────────────
  /**
   * Optional. When omitted/blank the service generates `{prefix}-EMP-{NNNN}`
   * using `Company.employeeCodePrefix` (or first 4 chars of company.code as
   * a fallback). Operators can still supply their own code if migrating
   * historical data.
   */
  @IsOptional() @IsString() employeeCode?: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() licensedBusinessUnitId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;

  // ── Person ─────────────────────────────────────────────────────────────
  @IsString() firstName!: string;
  @IsOptional() @IsString() middleName?: string;
  @IsString() lastName!: string;
  @IsString() fullName!: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() nationality?: string;

  // ── Contact ────────────────────────────────────────────────────────────
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;

  // ── Generic identity (legacy) ──────────────────────────────────────────
  @IsOptional() @IsString() identificationType?: string;
  @IsOptional() @IsString() identificationNumber?: string;

  // ── Tanzania-specific identity ─────────────────────────────────────────
  @IsOptional()
  @IsString()
  @Matches(NIDA_REGEX, {
    message: 'nidaNumber must be 20 digits (formatted as XXXXXXXX-XXXXX-XXXXX-XX or unformatted)',
  })
  nidaNumber?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsString() passportCountry?: string;
  @IsOptional() @IsString() votersIdNumber?: string;

  // ── Tax & statutory ────────────────────────────────────────────────────
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsString() nssfNumber?: string;
  @IsOptional() @IsString() nhifNumber?: string;
  @IsOptional() @IsString() pssfNumber?: string;
  @IsOptional() @IsString() wcfRegistrationNumber?: string;
  @IsOptional() @IsString() heslbNumber?: string;
  @IsOptional() @IsBoolean() heslbBorrower?: boolean;
  @IsOptional() @IsEnum(EmployeeTaxResidency) taxResidencyStatus?: EmployeeTaxResidency;
  @IsOptional() @IsEnum(DisabilityStatus) disabilityStatus?: DisabilityStatus;
  @IsOptional() @IsString() disabilityCertificateNo?: string;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) dependents?: number;
  @IsOptional() @IsEnum(HolidayRegion) payrollRegion?: HolidayRegion;

  // ── Payment ────────────────────────────────────────────────────────────
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccountName?: string;
  @IsOptional() @IsString() bankAccountNumber?: string;
  @IsOptional() @IsString() mobileMoneyNumber?: string;

  // ── Employment ─────────────────────────────────────────────────────────
  @IsOptional() @IsEnum(EmploymentStatus) employmentStatus?: EmploymentStatus;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsDateString() terminationDate?: string;
  @IsOptional() @IsNumber() @Type(() => Number) baseSalary?: number;
  @IsOptional() @IsString() salaryCurrency?: string;
  @IsOptional() @IsEnum(HRPaymentFrequency) paymentFrequency?: HRPaymentFrequency;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() userId?: string;

  // Audit is derived from the authenticated user, not accepted from clients.
}
