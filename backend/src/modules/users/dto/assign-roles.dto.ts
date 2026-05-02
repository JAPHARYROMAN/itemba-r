import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Replace the user's role assignment with the supplied set. Empty array
 * removes all roles. Cross-scope/role validation lives in the service
 * (e.g. only group-scoped roles can be assigned by group admins).
 */
export class AssignRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  roleIds!: string[];
}
