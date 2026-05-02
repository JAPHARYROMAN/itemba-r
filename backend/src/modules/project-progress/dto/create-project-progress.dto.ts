import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateProjectProgressDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() projectId!: string;
  @IsString() @IsOptional() siteId?: string;
  @IsDateString() progressDate!: string;
  @IsNumber() percentComplete!: number;
  @IsString() description!: string;
  @IsString() @IsOptional() notes?: string;
}
