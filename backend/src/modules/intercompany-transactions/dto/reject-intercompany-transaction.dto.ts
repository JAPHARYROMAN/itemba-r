import { IsNotEmpty, IsString } from 'class-validator';

export class RejectIntercompanyTransactionDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
