import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { RoleScope } from '@prisma/client';

export class CreateRoleDto {
  @IsString() name!: string;
  @IsString() displayName!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(RoleScope) scope!: RoleScope;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) permissionIds?: string[];
}
