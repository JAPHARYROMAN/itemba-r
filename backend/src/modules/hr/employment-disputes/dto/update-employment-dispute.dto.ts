import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { EmploymentDisputeResolution } from '@prisma/client';
import { CreateEmploymentDisputeDto } from './create-employment-dispute.dto';

export class UpdateEmploymentDisputeDto extends PartialType(CreateEmploymentDisputeDto) {}

export class MediateDisputeDto {
  @IsOptional() @IsString() mediationOutcome?: string;
}

export class ReferCmaDisputeDto {
  @IsOptional() @IsString() cmaReferenceNumber?: string;
  @IsOptional() @IsDateString() cmaHearingDate?: string;
  @IsOptional() @IsString() cmaArbitrator?: string;
}

export class ResolveDisputeDto {
  @IsEnum(EmploymentDisputeResolution) resolutionType!: EmploymentDisputeResolution;
  @IsOptional() @IsNumber() @Type(() => Number) resolutionAmount?: number;
  @IsOptional() @IsString() resolutionNotes?: string;
}
