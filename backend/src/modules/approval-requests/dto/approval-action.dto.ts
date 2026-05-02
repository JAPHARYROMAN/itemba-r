import { IsString, IsOptional } from 'class-validator';

export class ApprovalActionDto {
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() reason?: string;
}
