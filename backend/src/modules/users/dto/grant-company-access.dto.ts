import { IsArray, IsEnum, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AccessLevel } from '@prisma/client';

export class CompanyAccessGrant {
  @IsUUID() companyId!: string;
  @IsEnum(AccessLevel) accessLevel!: AccessLevel;
}

/** Replace the user's company-access set with the supplied list. */
export class GrantCompanyAccessDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompanyAccessGrant)
  access!: CompanyAccessGrant[];
}
