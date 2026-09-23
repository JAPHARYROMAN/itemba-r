import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
export class DeskReportQuery {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() partyId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency?: string;
}
