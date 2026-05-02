import { IsString, IsOptional, IsDateString, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class MaterialIssueLineDto {
  @IsString() productId!: string;
  @IsNumber() quantity!: number;
  @IsString() unitId!: string;
  @IsNumber() @IsOptional() unitCost?: number;
  @IsNumber() @IsOptional() totalCost?: number;
  @IsString() @IsOptional() boqItemId?: string;
}

export class CreateProjectMaterialIssueDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() projectId!: string;
  @IsString() @IsOptional() siteId?: string;
  @IsString() inventoryLocationId!: string;
  @IsDateString() issueDate!: string;
  @IsString() @IsOptional() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => MaterialIssueLineDto) lines!: MaterialIssueLineDto[];
}
