import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateDeliveryNoteDto } from './create-delivery-note.dto';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDeliveryNoteDto extends PartialType(OmitType(CreateDeliveryNoteDto, ['companyId'] as const)) {}

export class DeliverDto {
  @ApiPropertyOptional() @IsOptional() @IsString() receivedByName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() receivedByPhone?: string;
}
