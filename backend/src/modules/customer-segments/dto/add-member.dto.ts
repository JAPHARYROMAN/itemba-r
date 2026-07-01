import { IsNotEmpty, IsString } from 'class-validator';

export class AddSegmentMemberDto {
  @IsNotEmpty()
  @IsString()
  customerId!: string;
}
