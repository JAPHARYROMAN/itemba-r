import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { RoomType, RoomStatus } from '@prisma/client';

export class CreateRoomDto {
  @IsString() roomCode!: string;
  @IsString() companyId!: string;
  @IsString() hospitalityFacilityId!: string;
  @IsString() roomNumber!: string;
  @IsEnum(RoomType) roomType!: RoomType;
  @IsNumber() @Type(() => Number) defaultRate!: number;
  @IsString() currency!: string;
  @IsEnum(RoomStatus) @IsOptional() status?: RoomStatus;
  @IsString() @IsOptional() floor?: string;
  @IsNumber() @IsOptional() @Type(() => Number) maxOccupancy?: number;
  @IsString() @IsOptional() notes?: string;
}
