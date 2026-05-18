import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { AccountingLockStatus, AccountingLockType } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAccountingLockDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsEnum(AccountingLockType)
  lockType?: AccountingLockType;

  @IsOptional()
  @IsEnum(AccountingLockStatus)
  status?: AccountingLockStatus;
}

export class CreateAccountingLockDto {
  @IsString()
  lockCode!: string;

  @IsString()
  companyId!: string;

  @IsEnum(AccountingLockType)
  lockType!: AccountingLockType;

  @IsOptional()
  @IsString()
  moduleName?: string;

  @IsOptional()
  @IsString()
  fiscalYearId?: string;

  @IsOptional()
  @IsString()
  accountingPeriodId?: string;

  @IsOptional()
  @IsDateString()
  lockedFrom?: string | Date;

  @IsOptional()
  @IsDateString()
  lockedTo?: string | Date;

  @IsOptional()
  @IsString()
  reason?: string;
}
