import { IsString, IsUUID, MinLength, MaxLength, Matches } from 'class-validator';
export class ReverseLoanEventDto {
  @IsUUID() requestId!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
}
