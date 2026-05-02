import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { RoleScope } from '@prisma/client';

export class UpdateRoleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(RoleScope) scope?: RoleScope;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) permissionIds?: string[];
}
