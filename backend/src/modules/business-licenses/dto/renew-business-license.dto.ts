import { IsDateString } from 'class-validator';

export class RenewBusinessLicenseDto {
  @IsDateString() newExpiryDate!: string;
  @IsDateString() newRenewalDate!: string;
}
