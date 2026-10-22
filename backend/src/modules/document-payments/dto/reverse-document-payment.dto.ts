import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReverseDocumentPaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
