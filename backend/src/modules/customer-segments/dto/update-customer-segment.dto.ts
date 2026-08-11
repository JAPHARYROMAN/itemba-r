import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateCustomerSegmentDto {
  // companyId is accepted so the service can reject attempts to move a record
  // to another company; it is treated as immutable on update.
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  segmentCode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  criteria?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
