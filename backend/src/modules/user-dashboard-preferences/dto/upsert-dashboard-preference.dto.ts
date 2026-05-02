import { IsOptional, IsObject, IsBoolean } from 'class-validator';

export class UpsertDashboardPreferenceDto {
  @IsOptional()
  @IsObject()
  layoutOverride?: Record<string, any>;

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
