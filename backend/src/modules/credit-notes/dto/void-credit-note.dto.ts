import { IsNotEmpty, IsString } from 'class-validator';

export class VoidCreditNoteDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
