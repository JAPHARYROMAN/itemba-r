import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContractStatus } from '@prisma/client';

export class ChangeContractStatusDto {
  @IsNotEmpty() @IsEnum(ContractStatus) status!: ContractStatus;
  @IsOptional() @IsString() notes?: string;
}
