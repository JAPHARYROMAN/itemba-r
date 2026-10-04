import {
  Equals,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const POS_DRAFT_KINDS = [
  'SALE',
  'COLLECTION',
  'RECEIPT',
  'TRANSFER',
  'COUNT',
  'DAMAGE',
] as const;
export class SubmitPosDraftDto {
  @IsString() @MinLength(16) @MaxLength(100) requestId!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsString() branchId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
  @IsDateString() capturedAt!: string;
  @IsIn(POS_DRAFT_KINDS) kind!: (typeof POS_DRAFT_KINDS)[number];
  @IsObject() payload!: Record<string, unknown>;
}
export class CorrectPosDraftDto extends SubmitPosDraftDto {
  @IsInt() @Min(1) revision!: number;
}
export class PosDraftRevisionDto {
  @IsInt() @Min(1) revision!: number;
}
export class ApprovePosDraftDto extends PosDraftRevisionDto {
  @IsOptional() @IsString() @MinLength(5) @MaxLength(500) duplicateReason?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) reviewedCandidateIds?: string[];
}
export class RejectPosDraftDto extends PosDraftRevisionDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class ConfirmReturnPosDraftDto extends PosDraftRevisionDto {
  @Equals(true) fundsReturned!: true;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
}
