import { IsNotEmpty, IsString } from 'class-validator';

export class WriteOffReceivableDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
