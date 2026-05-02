import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProductBatchDto } from './create-product-batch.dto';
import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductBatchStatus } from '@prisma/client';

export class UpdateProductBatchDto extends PartialType(OmitType(CreateProductBatchDto, ['companyId'] as const)) {
  @ApiPropertyOptional({ enum: ProductBatchStatus }) @IsOptional() @IsEnum(ProductBatchStatus) status?: ProductBatchStatus;
}
