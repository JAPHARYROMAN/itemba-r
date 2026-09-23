import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeskSupplierDto } from '../invoice-desk/invoice-desk.dto';
export class SalesCustomerDto extends DeskSupplierDto {}
export class SalesQuery {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() divisionId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['all', 'unpaid', 'partial', 'paid', 'overdue', 'void']) status?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class SalesLineDto {
  @IsString() @MinLength(1) @MaxLength(250) description!: string;
  @Matches(/^\d{1,9}(\.\d{1,3})?$/) quantity!: string;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) unitPrice!: string;
}
export class SalesCreateDto {
  @IsUUID() requestId!: string;
  @IsUUID() companyId!: string;
  @IsUUID() divisionId!: string;
  @IsUUID() branchId!: string;
  @IsUUID() customerId!: string;
  @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) saleDate!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class SalesPaymentDto {
  @IsUUID() requestId!: string;
  @IsUUID() accountId!: string;
  @IsInt() @Min(1) version!: number;
  @Matches(/^\d{1,16}(\.\d{1,2})?$/) amount!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) paymentDate!: string;
  @IsString() @MaxLength(160) reference!: string;
}
export class SalesVoidDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
