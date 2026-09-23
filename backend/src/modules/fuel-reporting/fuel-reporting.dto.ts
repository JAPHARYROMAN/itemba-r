import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class ReadingDto {
  @IsUUID() nozzleId!: string;
  @IsString() @MaxLength(160) attendantName!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e10) opening!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e10) closing!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1e7) price!: number | null;
}
class DipDto {
  @IsUUID() tankId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e10) opening!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e10) closing!: number | null;
}
class DeliveryDto {
  @IsUUID() productId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(1e10) litres!: number;
  @IsString() @MaxLength(160) supplier!: string;
  @IsString() @MaxLength(160) reference!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) totalCost!: number | null;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) paidAmount!: number;
  @IsIn(['SHIFT_CASH', 'OTHER']) paymentSource!: string;
}
class ExpenseDto {
  @IsString() @MaxLength(100) category!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) amount!: number;
  @IsIn(['SHIFT_CASH', 'OTHER']) paymentSource!: string;
}
class CreditDto {
  @IsString() @MaxLength(160) customer!: string;
  @IsString() @MaxLength(160) reference!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) amount!: number;
}
class CollectionsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) cash!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) mobile!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) bank!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) openingCash!: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1e12) cashHandedOver!:
    | number
    | null;
}
export class ReportPayloadDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReadingDto)
  readings!: ReadingDto[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DipDto) dips!: DipDto[];
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeliveryDto)
  deliveries!: DeliveryDto[];
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExpenseDto)
  expenses!: ExpenseDto[];
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreditDto)
  creditSales!: CreditDto[];
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CollectionsDto)
  collections!: CollectionsDto;
  @IsBoolean() receiptsConfirmed!: boolean;
  @IsBoolean() expensesConfirmed!: boolean;
  @IsString() @MaxLength(4000) notes!: string;
  @IsString() @MaxLength(4000) discrepancyReason!: string;
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) documentIds!: string[];
}
export class SaveFuelReportDto {
  @IsUUID() branchId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
  @IsIn(['DAY', 'NIGHT']) shift!: string;
  @IsInt() @Min(0) version!: number;
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReportPayloadDto)
  payload!: ReportPayloadDto;
  @IsOptional() @IsBoolean() close?: boolean;
}
export class ReopenFuelReportDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @MaxLength(1000) reason!: string;
}
class NozzleSetupDto {
  @IsString() @MaxLength(60) code!: string;
  @IsUUID() tankId!: string;
}
export class CreateReportingPumpDto {
  @IsUUID() branchId!: string;
  @IsString() @MaxLength(60) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NozzleSetupDto)
  nozzles!: NozzleSetupDto[];
}
export class CreateReportingTankDto {
  @IsUUID() branchId!: string;
  @IsUUID() productId!: string;
  @IsString() @MaxLength(60) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(1) @Max(1e10) capacityLitres!: number;
}
export class ReportingStationDetailsDto {
  @IsString() @MaxLength(60) @Matches(/\S/) code!: string;
  @IsString() @MaxLength(160) @Matches(/\S/) name!: string;
  @IsString() @MaxLength(300) location!: string;
}
export class CreateReportingStationDto extends ReportingStationDetailsDto {
  @IsUUID() divisionId!: string;
}
