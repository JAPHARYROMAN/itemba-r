import { IsNotEmpty, IsString } from 'class-validator';

export class RejectExpenseDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
