import { IsObject, IsOptional, IsString } from 'class-validator';

export class ResolveConflictDto {
  @IsOptional()
  @IsString()
  resolution?: string;

  @IsOptional()
  @IsObject()
  resolvedValue?: Record<string, any>;
}
