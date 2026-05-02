import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateReportRunDto {
  @IsString()
  reportDefinitionId!: string;

  @IsOptional()
  @IsString()
  savedReportViewId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;
}
