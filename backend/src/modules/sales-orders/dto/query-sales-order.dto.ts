import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SalesOrderStatus, SalesType, PaymentStatus, SalesPaymentMethod } from '@prisma/client';

export class QuerySalesOrderDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() salespersonId?: string;
  @IsOptional() @IsEnum(SalesType) salesType?: SalesType;
  @IsOptional() @IsEnum(SalesOrderStatus) status?: SalesOrderStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsEnum(SalesPaymentMethod) paymentMethod?: SalesPaymentMethod;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
