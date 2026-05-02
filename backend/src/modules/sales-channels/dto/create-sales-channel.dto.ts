import { IsString, IsOptional, IsBoolean, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesChannelType } from '@prisma/client';

export class CreateSalesChannelDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: SalesChannelType }) @IsEnum(SalesChannelType) channelType!: SalesChannelType;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
