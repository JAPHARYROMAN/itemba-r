import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateReturnablePackageDto } from './create-returnable-package.dto';
import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnablePackageStatus } from '@prisma/client';

export class UpdateReturnablePackageDto extends PartialType(OmitType(CreateReturnablePackageDto, ['companyId'] as const)) {
  @ApiPropertyOptional({ enum: ReturnablePackageStatus }) @IsOptional() @IsEnum(ReturnablePackageStatus) status?: ReturnablePackageStatus;
}
