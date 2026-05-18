import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { PostingRunStatus, PostingSourceType } from '@prisma/client';
import { CompanyPagedQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryPostingRunDto extends CompanyPagedQueryDto {
  @IsOptional()
  @IsEnum(PostingRunStatus)
  status?: PostingRunStatus;
}

export class CreatePostingRunDto {
  @IsString()
  postingRunNumber!: string;

  @IsString()
  companyId!: string;

  @IsEnum(PostingSourceType)
  sourceType!: PostingSourceType;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @IsString()
  postingRuleId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalDebit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalCredit?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
