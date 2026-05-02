import { IsNotEmpty, IsString } from 'class-validator';

export class WriteOffPayableDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
